"""Run Claude with a bounded Codex fallback, or serve its restricted MCP tools."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile

# Isolated Python omits the script directory; trust only this sibling module.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import config

DIR = Path(__file__).resolve().parent
SLACK_TOOLS = ["conversations_history", "conversations_replies", "conversations_search_messages"]


def execute(argv, timeout):
    """Run a provider with a deadline that also stops its MCP subprocesses."""
    process = subprocess.Popen(argv, cwd=DIR, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, text=True, start_new_session=True)
    def stop():
        """Stop the whole provider group, including its MCP servers."""
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
        except ProcessLookupError:
            process.communicate()

    def interrupted(signum, _frame):
        """Forward refresh shutdown to a provider running in its own session."""
        stop()
        raise SystemExit(128 + signum)

    previous = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGTERM, signal.SIGHUP)}
    try:
        output, _ = process.communicate(timeout=timeout)
        return process.returncode, output
    except subprocess.TimeoutExpired:
        stop()
        return 124, "Provider timed out"
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def claude(c, prompt):
    """Return a report only when Claude's structured result confirms success."""
    cl = c["claude"]
    argv = ["claude", "-p", prompt, "--model", cl["model"], "--effort", cl["effort"],
            "--output-format", "json", "--no-session-persistence", "--setting-sources", "project,local",
            "--settings", '{"autoMemoryEnabled": false}', "--strict-mcp-config",
            "--permission-mode", "dontAsk", "--tools", "Bash,Read,Grep,Glob",
            "--allowedTools", *config.tools(c).splitlines()]
    mcp = config.mcp(c)
    if mcp:
        argv += ["--mcp-config", mcp]
    status, output = execute(argv, cl["timeout_minutes"] * 60)
    if status:
        return status, output
    try:
        result = json.loads(output)
        if result.get("is_error") or result.get("subtype") != "success":
            return 1, output
        report = result["result"].strip()
        return (0, report) if report else (1, "Claude returned no report")
    except (ValueError, KeyError, AttributeError, TypeError):
        return 1, "Claude returned an invalid result"


def codex(c, prompt):
    """Run Sol using only the board bridge and configured read-only Slack tools."""
    options = config.codex_options(c)
    with tempfile.TemporaryDirectory(prefix="work-board-codex-") as tmp:
        output = Path(tmp) / "report.txt"
        schema = Path(tmp) / "result.schema.json"
        schema.write_text(json.dumps({"type": "object", "properties": {
            "completed": {"type": "boolean"}, "report": {"type": "string"}},
            "required": ["completed", "report"], "additionalProperties": False}))
        overrides = {
            "approval_policy": "never", "web_search": "disabled",
            # Sol needs the code-mode router to call MCP; it has no direct filesystem access.
            "features.shell_tool": False, "features.multi_agent": False,
            **{"features." + name: False for name in (
                "apps", "plugins", "view_image", "unified_exec", "image_generation",
                "computer_use", "browser_use", "memories", "tool_suggest", "skill_mcp_dependency_install")},
            "mcp_servers.board": {"command": sys.executable,
                "args": ["-I", str(Path(__file__).resolve()), "--mcp"], "required": True,
                "default_tools_approval_mode": "approve", "env_vars": sorted(os.environ),
                "startup_timeout_sec": 60, "tool_timeout_sec": 120},
        }
        if "slack" in c:
            cmd = [os.path.expanduser(a) for a in c["slack"]["mcp_command"]]
            overrides["mcp_servers.slack"] = {"command": cmd[0], "args": cmd[1:],
                "enabled_tools": SLACK_TOOLS, "required": True, "default_tools_approval_mode": "approve",
                "env_vars": sorted(os.environ), "startup_timeout_sec": 60, "tool_timeout_sec": 120}
        argv = ["codex", "exec", "--ignore-user-config", "--ephemeral", "--sandbox", "read-only",
                "--model", options.get("model", "gpt-6.1-sol"), "--output-schema", str(schema),
                "--output-last-message", str(output)]
        overrides["model_reasoning_effort"] = options.get("effort", "high")
        for key, value in overrides.items():
            # JSON scalars/arrays are valid TOML; inline tables need TOML's '=' separators.
            argv += ["-c", key + "=" + toml_value(value)]
        argv.append(prompt + "\n\nCodex tool mapping: use board.command with an argv array for the "
                    "python3/gh/date commands above, and board.read_file for local files. "
                    "Use only these tools and the read-only Slack tools. "
                    "A previous provider may have made partial updates; read the current data first "
                    "and do not duplicate history entries. Return JSON with completed and report. "
                    "Set completed=true only after all required source checks and board updates succeed. "
                    "If a source or tool is unavailable or the check is incomplete, set completed=false "
                    "and explain the failure in report. Put the notification text (or NO_UPDATE) in report.")
        status, _ = execute(argv, options.get("timeout_minutes", c["claude"]["timeout_minutes"]) * 60)
        try:
            result = json.loads(output.read_text())
            report = result["report"].strip()
            if status == 0 and result["completed"] is True and report:
                return 0, report
            return status or 1, report or "Codex did not complete a report"
        except (OSError, ValueError, KeyError, AttributeError, TypeError):
            return status or 1, "Codex did not complete a valid report"


def toml_value(value):
    """Encode the small set of TOML values used in Codex configuration overrides."""
    if isinstance(value, dict):
        return "{" + ", ".join(json.dumps(k) + " = " + toml_value(v) for k, v in value.items()) + "}"
    return json.dumps(value)


def call_tool(c, name, args):
    """Enforce the board's existing command and file access boundaries without a shell."""
    if name == "read_file":
        file = (DIR / args["path"]).resolve()
        if not file.is_relative_to(DIR) or not file.is_file():
            raise ValueError("Read only files inside the board folder")
        return file.read_text()
    if name != "command":
        raise ValueError("Unknown tool")
    argv = args["argv"]
    if not isinstance(argv, list) or not argv or not all(isinstance(a, str) for a in argv):
        raise ValueError("argv must be a nonempty list of strings")
    prefixes = [["python3", "-I", "db.py", "query"], ["python3", "-I", "db.py", "exec"], ["date"]]
    if "t3" in c:
        prefixes.append(["python3", "-I", "t3_recent.py"])
    if "github" in c:
        prefixes += [["gh", *p.split()] for p in
                     ("search prs", "search issues", "pr view", "pr checks", "pr diff", "issue view", "run view")]
    if not any(argv[:len(p)] == p for p in prefixes) or (argv[0] == "gh" and any(
            a.startswith("--web") or (a.startswith("-") and not a.startswith("--") and "w" in a)
            for a in argv[1:])):
        raise ValueError("Command is not allowed")
    result = subprocess.run(argv, cwd=DIR, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise ValueError(result.stderr or result.stdout or f"Exit {result.returncode}")
    return result.stdout


def serve(c):
    """Expose restricted board operations over MCP's newline-delimited stdio transport."""
    tool_list = [
        {"name": "command", "description": "Run an allowed db.py query/exec, read-only gh, date or t3_recent.py command without a shell.",
         "inputSchema": {"type": "object", "properties": {"argv": {"type": "array", "items": {"type": "string"}}}, "required": ["argv"]}},
        {"name": "read_file", "description": "Read a text file inside the board folder.",
         "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}},
    ]
    for line in sys.stdin:
        request = json.loads(line)
        if "id" not in request:
            continue
        method = request["method"]
        if method == "initialize":
            result = {"protocolVersion": request["params"]["protocolVersion"],
                      "capabilities": {"tools": {}}, "serverInfo": {"name": "work-board", "version": "1"}}
        elif method == "ping":
            result = {}
        elif method == "tools/list":
            result = {"tools": tool_list}
        elif method == "tools/call":
            try:
                params = request["params"]
                result = {"content": [{"type": "text", "text": call_tool(c, params["name"], params.get("arguments", {}))}]}
            except (ValueError, OSError, KeyError, TypeError, subprocess.TimeoutExpired) as e:
                result = {"isError": True, "content": [{"type": "text", "text": str(e)}]}
        else:
            print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "error": {"code": -32601, "message": "Unknown method"}}), flush=True)
            continue
        print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)


def main():
    """Prefer Claude and attempt Codex once on provider failure or unavailability."""
    c = config.load()
    if sys.argv[1:] == ["--mcp"]:
        serve(c)
        return
    prompt = sys.stdin.read()
    try:
        status, report = claude(c, prompt)
    except (OSError, ValueError) as e:
        status, report = 1, str(e)
    if status:
        print(f"Claude failed (exit {status}): {report}\nTrying Codex fallback", file=sys.stderr)
        try:
            status, report = codex(c, prompt)
        except (OSError, ValueError) as e:
            status, report = 1, str(e)
    if status:
        print(report, file=sys.stderr)
    else:
        print(report)
    sys.exit(status)


if __name__ == "__main__":
    main()
