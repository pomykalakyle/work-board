# Work Board

A personal work-task board: an hourly headless Claude run (`run.sh`, following `prompt.md` and `ranking.md`) reads Slack, GitHub and T3 threads into `work.db`, `render_board.py` turns that into `board.json`, and an Electron + Svelte 5 app in `app/` shows it.

## Svelte: follow the current docs, not memory

Svelte changes quickly and your training data is probably behind it. Before writing or reviewing Svelte code here, read the current official docs, especially the [best practices page](https://svelte.dev/docs/svelte/best-practices) and the full [llms.txt](https://svelte.dev/docs/svelte/llms.txt), and follow them over what you remember. One example of the drift: since Svelte 5.56, `{@const x = y}` is legacy. Its replacement is a declaration tag, `{const x = $derived(y)}`, and a plain `{const x = y}` doesn't update when `y` changes. Match what the app already does (runes, `{@attach}`, classes with `$state` fields), and run `npm run typecheck` in `app/` after a change.

## Keep it open-sourceable

Write the project so that anyone could clone it and run it with their own accounts. Personal data lives only in gitignored files: `config.toml`, `preferences.md`, `work.db`, `board.json`, `board.html`, `reports.md` and `logs/`. Tracked files (code, `prompt.md`, `ranking.md`, `config.example.toml`) should hold no real names, Slack or GitHub IDs, channels, company details, emails or home-directory paths. Anything another user would need to change goes in `config.toml`, with a generic, documented entry in `config.example.toml`. How the user likes to work (who to weigh, how long to wait before chasing, team norms) is a preference: it goes in `preferences.md`, with neutral defaults in `preferences.example.md`, never in `prompt.md`, `ranking.md` or `standup.md`. Keys come from the environment or a secret store at runtime and are never written into files.
