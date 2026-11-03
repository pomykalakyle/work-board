# Work Board

A desktop board of your work tasks that a Claude Code agent keeps up to date. Every hour it reads your Slack, GitHub and T3 Code threads, finds new asks and changes to existing work, and ranks your tasks so you can see what to do next. A small Electron app shows the board and redraws when the data changes.

It runs on macOS with Apple Silicon.

## How it works

1. launchd runs `run.sh` once an hour, during the hours you set on the app's Settings page.
2. `run.sh` starts a headless `claude -p` run with `prompt.md`.
   If Claude fails, times out, runs out of usage or is unavailable, it retries once with Sol through Codex.
   The agent reads your sources and writes tasks and their history into `work.db`, a local SQLite file.
3. `render_board.py` turns `work.db` into `board.json`, and the app picks up the new file. A Mac notification lists what changed.

Each task gets a tier (Must, Should or Later) and a score from its impact, urgency and effort. The rules live in `ranking.md`, and the app's "How scoring works" page shows the same text.

## Requirements

- A Mac with Apple Silicon
- Python 3.11 or newer (`brew install python`). The `python3` that ships with macOS is 3.9, which is too old.
- Node.js 22.12 or newer, to build the app (`brew install node`)
- [Claude Code](https://docs.claude.com/en/docs/claude-code/overview), signed in
- [Codex CLI](https://developers.openai.com/codex/noninteractive), signed in, for automatic fallback
- For GitHub: the [GitHub CLI](https://cli.github.com/), signed in as you
- For Slack: a Slack MCP server that offers `conversations_history`, `conversations_replies` and `conversations_search_messages`, such as [korotovsky/slack-mcp-server](https://github.com/korotovsky/slack-mcp-server)
- For T3 Code threads: T3 Code installed on the same Mac

Each source is optional. Leave its section out of `config.toml` and the agent skips it.

## Setup

Clone the repo, then run:

```sh
./install.sh
```

The first run copies `config.example.toml` to `config.toml` and stops. Fill in `config.toml` with who you are, your projects in priority order and the sources to read, then run `./install.sh` again. The second run checks the config and the tools each source needs, creates the database, builds the app into `~/Applications/Work Board.app`, and then schedules the hourly check with launchd. The check finds missing tools and a signed-out `gh`, but it can't tell whether your Claude or Slack sign-in works, so run one check by hand to be sure.

To fill the board right away, run `./run.sh` or press ⌘R in the app. A run takes about a minute.

### Slack

The hourly check runs from launchd, which doesn't see tokens exported in your shell, so the Slack server needs a way to load its own. With [korotovsky/slack-mcp-server](https://github.com/korotovsky/slack-mcp-server), one way is a user token (`xoxp-`) in your Keychain and a small wrapper script:

1. Store the token. This asks for it, so it never lands in your shell history:

   ```sh
   security add-generic-password -s slack-mcp-xoxp -a "$USER" -w
   ```

2. Save this as `~/.local/bin/slack-mcp` and run `chmod +x` on it:

   ```sh
   #!/bin/bash
   export SLACK_MCP_XOXP_TOKEN="$(security find-generic-password -s slack-mcp-xoxp -w)"
   exec /opt/homebrew/bin/slack-mcp-server "$@"
   ```

3. In `config.toml`, set `mcp_command = ["~/.local/bin/slack-mcp", "--transport", "stdio"]`.

That server's README covers how to get a token. Leave its posting tool off (it is unless you set `SLACK_MCP_ADD_MESSAGE_TOOL`); the agent can't call it either way.

## Using the app

- Do next holds the top four Must and Should tasks. Later and Blocked hold the rest.
- Each project in `config.toml` gets its own page, which also lists its done tasks.
- History shows everything the agent has logged.
- Preferences is where you tell the agent who you work with and how you like to work, for example how long to wait before chasing someone. It saves to `preferences.md`, and the next run reads it.
- Standup shows a draft end-of-day update with a copy button. It appears only when `[standup]` is enabled in `config.toml`.
- How scoring works shows the ranking rules.
- Settings turns the automatic checks on or off, sets their hours and days, and shows which sources, model and effort the agent uses. ⌘, opens it.
- Keyboard lists every shortcut. Each action can have up to two keys, so you can add letters for moving around (h/j/k/l, say) next to the arrow keys.

If you disagree with a score, ask a coding agent in this folder to pin it, for example "pin api-docs urgency 4". The hourly run never changes a pinned value.

## Cost

Each run is a full Claude Code session with the model and effort set in `config.toml`. The example config uses Opus at high effort with a 30 minute cap. The default schedule, 8am to 10pm on weekdays, comes to 15 runs a day, so check your Claude plan or API spend before you leave it on. Fewer hours on the Settings page, or a smaller model in `config.toml`, cuts the cost. Turning automatic checks off stops the hourly runs; Check now still works.

The fallback defaults to `gpt-6.1-sol` at high effort and uses the same timeout as Claude.
Optional `[codex]` settings in `config.toml` override `model`, `effort` and `timeout_minutes`.
Each refresh tries Claude first, then Codex once; if both fail, the last successful check timestamp stays unchanged and the refresh exits with an error.

To spread runs over several Claude accounts, run a proxy such as [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) and set `base_url` under `[claude]` to its address.
If the proxy checks API keys, set `auth_token_command` to a command that prints the key, so the key stays out of `config.toml`.

## Your data

The board itself stays on your Mac, though the agent sends what it reads to Claude, or OpenAI when fallback is used, to process it.
Your settings and data are in gitignored files: `config.toml`, `preferences.md`, `work.db`, `board.json`, `board.html`, `reports.md` and `logs/`.

The agent runs with a short list of allowed tools (`tools()` in `config.py`) in Claude Code's `dontAsk` mode, which turns down anything not on the list.
It can read files only inside this folder, call three read-only Slack tools, and run read-only `gh` commands.
Its one write path is `db.py`, and SQLite itself limits that to adding and updating tasks, adding history entries and writing the standup draft.
Codex runs in a read-only sandbox with shell execution disabled and user config excluded.
A restricted MCP bridge exposes the same read-only source commands and guarded `db.py` writes; Slack exposes only the three read tools.
The prompt also tells it never to post, reply or comment anywhere.
Slack messages come from other people, so a message could try to steer the agent.
With these limits, that mostly means wrong entries on your board.

## License

MIT. See [LICENSE](LICENSE).
