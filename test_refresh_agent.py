"""Focused provider-failover and restricted-tool regression tests."""
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import refresh_agent as agent

C = {"claude": {"model": "test", "effort": "high", "timeout_minutes": 1}}


class RefreshTests(unittest.TestCase):
    """Verify successful reports, fallback transitions and enforced tool boundaries."""

    def test_claude_structured_results(self):
        """Reject usage errors even when the CLI exits zero."""
        for payload, expected in [({"subtype": "success", "result": "NO_UPDATE"}, 0),
                                  ({"subtype": "success", "is_error": True, "result": "Usage limit"}, 1),
                                  ({"subtype": "error_during_execution"}, 1),
                                  ({"subtype": "success", "result": ""}, 1)]:
            with self.subTest(payload=payload), patch.object(agent, "execute", return_value=(0, json.dumps(payload))):
                self.assertEqual(agent.claude(C, "prompt")[0], expected)

    def test_fallback_and_exit_status(self):
        """Use fallback on errors and missing binaries, but leave successful Claude alone."""
        for primary, secondary, expected, calls in [((0, "NO_UPDATE"), (1, "bad"), 0, 0),
                                                   ((1, "quota"), (0, "Updated"), 0, 1),
                                                   (FileNotFoundError("claude"), (0, "Updated"), 0, 1),
                                                   ((124, "timeout"), (1, "bad"), 1, 1)]:
            with self.subTest(primary=primary), patch.object(agent.config, "load", return_value=C), \
                    patch.object(sys, "argv", ["refresh_agent.py"]), patch.object(sys, "stdin", io.StringIO("prompt")), \
                    patch.object(agent, "claude", **({"side_effect": primary} if isinstance(primary, Exception) else {"return_value": primary})), \
                    patch.object(agent, "codex", return_value=secondary) as fallback, \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as result:
                    agent.main()
                self.assertEqual(result.exception.code, expected)
                self.assertEqual(fallback.call_count, calls)

    def test_codex_requires_success_and_final_report(self):
        """An empty report or failing provider must never count as a successful refresh."""
        for status, report, expected in [(0, "NO_UPDATE", 0), (0, "", 1), (1, "partial", 1)]:
            def fake_execute(argv, timeout, env=None):
                """Simulate Codex's final-message artifact and inspect its restrictions."""
                Path(argv[argv.index("--output-last-message") + 1]).write_text(json.dumps({"completed": True, "report": report}))
                self.assertIn("--ignore-user-config", argv)
                self.assertIn("read-only", argv)
                self.assertIn("features.shell_tool=false", argv)
                self.assertIn("features.apps=false", argv)
                self.assertIn("features.plugins=false", argv)
                self.assertIn("features.view_image=false", argv)
                settings = " ".join(argv[:-1])
                self.assertIn('"env_vars" = [', settings)
                self.assertIn('"tool_timeout_sec" = 120', settings)
                return status, "progress"
            with self.subTest(status=status, report=report), patch.object(agent, "execute", side_effect=fake_execute):
                self.assertEqual(agent.codex(C, "prompt")[0], expected)

    def test_codex_rejects_incomplete_refresh(self):
        """Reject an explicit incomplete result even when Codex exits successfully."""
        def fake_execute(argv, timeout, env=None):
            """Write a valid but unsuccessful structured result."""
            Path(argv[argv.index("--output-last-message") + 1]).write_text(
                json.dumps({"completed": False, "report": "Slack was unavailable"}))
            return 0, ""
        with patch.object(agent, "execute", side_effect=fake_execute):
            status, report = agent.codex(C, "prompt")
            self.assertEqual(status, 1)
            self.assertEqual(report, "Slack was unavailable")

    def test_bridge_and_database_permissions(self):
        """Real SQLite writes pass the guard while forbidden commands and SQL fail."""
        with tempfile.TemporaryDirectory() as tmp, patch.object(agent, "DIR", Path(tmp)):
            root = Path(tmp)
            shutil.copy(Path(__file__).parent / "db.py", root)
            db = sqlite3.connect(root / "work.db")
            db.executescript(agent.config.SCHEMA)
            db.close()
            agent.call_tool(C, "command", {"argv": ["python3", "-I", "db.py", "exec",
                "INSERT INTO work_tasks(task_key,title,status) VALUES(?,?,?)", '["smoke","Smoke","open"]']})
            rows = json.loads(agent.call_tool(C, "command", {"argv": ["python3", "-I", "db.py", "query", "SELECT title FROM work_tasks"]}))
            self.assertEqual(rows["rows"], [["Smoke"]])
            for argv in [["sh", "-c", "true"], ["gh", "pr", "comment", "1"],
                         ["gh", "pr", "view", "1", "--web=true"], ["gh", "pr", "checks", "1", "-cw"],
                         ["python3", "-I", "db.py", "exec", "DELETE FROM work_tasks"],
                         ["python3", "-I", "db.py", "exec", "UPDATE work_projects SET name='bad'"]]:
                with self.subTest(argv=argv), self.assertRaises(ValueError):
                    agent.call_tool(C, "command", {"argv": argv})
            with self.assertRaises(ValueError):
                agent.call_tool(C, "read_file", {"path": "../outside"})
            (root / "link").symlink_to(Path(__file__).resolve())
            with self.assertRaises(ValueError):
                agent.call_tool(C, "read_file", {"path": "link"})

    def test_run_script_timestamp_and_status(self):
        """Run the real shell/export/render path with simulated providers in a private board."""
        source = Path(__file__).parent
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ("run.sh", "refresh_agent.py", "config.py", "db.py", "render_board.py",
                         "prompt.md", "ranking.md", "standup.md", "preferences.example.md"):
                shutil.copy(source / name, root / name)
            shutil.copy(source / "config.example.toml", root / "config.toml")
            binaries = root / "bin"
            binaries.mkdir()
            script = (root / "run.sh").read_text().replace('export PATH="', f'export PATH="{binaries}:', 1)
            (root / "run.sh").write_text(script)
            (binaries / "claude").write_text("#!/bin/sh\n" +
                "printf '%s\\n' '{\"subtype\":\"success\",\"is_error\":true,\"result\":\"quota\"}'\n")
            (binaries / "codex").write_text(f"#!{sys.executable}\n" +
                "import os, pathlib, sys\n" +
                "if os.environ['SMOKE_FAIL'] == '1': sys.exit(1)\n" +
                "pathlib.Path(sys.argv[sys.argv.index('--output-last-message')+1]).write_text('{\"completed\":true,\"report\":\"NO_UPDATE\"}')\n")
            (binaries / "osascript").write_text("#!/bin/sh\nexit 0\n")
            for binary in binaries.iterdir():
                binary.chmod(0o700)
            for fail in ("0", "1"):
                (root / "last_check").write_text("2000-01-01 00:00\n")
                result = subprocess.run(["bash", str(root / "run.sh")], cwd=root,
                                        env={**os.environ, "SMOKE_FAIL": fail}, capture_output=True, text=True)
                self.assertEqual(result.returncode, int(fail), result.stderr)
                self.assertEqual((root / "last_check").read_text() == "2000-01-01 00:00\n", fail == "1")
                self.assertTrue((root / "board.json").exists())

    def test_provider_stops_when_runner_is_terminated(self):
        """Terminating the refresh runner must also stop its detached provider."""
        with tempfile.TemporaryDirectory() as tmp:
            pidfile = Path(tmp) / "provider.pid"
            child = "import os,pathlib,time; pathlib.Path(" + repr(str(pidfile)) + ").write_text(str(os.getpid())); time.sleep(30)"
            wrapper = "import refresh_agent as a,sys; a.execute([sys.executable,'-c'," + repr(child) + "],60)"
            process = subprocess.Popen([sys.executable, "-c", wrapper], cwd=Path(__file__).parent)
            try:
                deadline = time.monotonic() + 5
                while not pidfile.exists() and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertTrue(pidfile.exists())
                provider_pid = int(pidfile.read_text())
                process.terminate()
                self.assertEqual(process.wait(timeout=8), 143)
                with self.assertRaises(ProcessLookupError):
                    os.kill(provider_pid, 0)
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=8)

    def test_codex_config_validation(self):
        """Reject invalid fallback options before starting a provider."""
        self.assertEqual(agent.config.codex_options(C)["model"], "gpt-6.1-sol")
        for section in ({"timeout_minutes": "30"}, {"timeout_minutes": True}, {"model": 6}, {"effort": "bad"}):
            with self.subTest(section=section), self.assertRaises(ValueError):
                agent.config.codex_options({**C, "codex": section})

    def test_claude_proxy_env(self):
        """base_url points Claude at a proxy with a token, and never forwards the user's own credentials."""
        self.assertIsNone(agent.config.claude_env(C))
        proxy = {"claude": {**C["claude"], "base_url": "http://127.0.0.1:8317"}}
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "real", "CLAUDE_CODE_OAUTH_TOKEN": "real"}):
            env = agent.config.claude_env(proxy)
            self.assertEqual((env["ANTHROPIC_BASE_URL"], env["ANTHROPIC_AUTH_TOKEN"]), ("http://127.0.0.1:8317", "work-board"))
            self.assertNotIn("ANTHROPIC_API_KEY", env)
            self.assertNotIn("CLAUDE_CODE_OAUTH_TOKEN", env)
        keyed = {"claude": {**proxy["claude"], "auth_token_command": [sys.executable, "-c", "print('k1')"]}}
        self.assertEqual(agent.config.claude_env(keyed)["ANTHROPIC_AUTH_TOKEN"], "k1")
        for bad in ({"base_url": "127.0.0.1:8317"}, {"auth_token_command": "secret get X"},
                    {"auth_token_command": [sys.executable, "-c", "pass"]}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                agent.config.claude_env({"claude": {**proxy["claude"], **bad}})
        with patch.object(agent, "execute", return_value=(0, json.dumps({"subtype": "success", "result": "ok"}))) as run:
            agent.claude(proxy, "prompt")
            self.assertEqual(run.call_args.args[2]["ANTHROPIC_BASE_URL"], "http://127.0.0.1:8317")

    def test_timeout(self):
        """A stuck provider is stopped promptly and becomes a fallback-eligible error."""
        status, _ = agent.execute([sys.executable, "-c", "import time; time.sleep(30)"], 0.1)
        self.assertEqual(status, 124)


if __name__ == "__main__":
    unittest.main()
