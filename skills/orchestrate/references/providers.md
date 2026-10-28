# Providers: how each CLI is started

Flags checked against each vendor's documentation on 2026-10-26. Command lines come from `scripts/lib/providers.mjs`.
CLIs change fast: when a launch fails with an "unknown option" error, check `--help` of that CLI and update the file.

Every worker is told, through a short prompt, to read `.playmaker/brief.md` in its worktree. The brief is never passed on the command line, which avoids quoting and length limits on Windows.

| Provider | Binary | Headless command (as built) | Mode |
|---|---|---|---|
| Claude Code | `claude` | `claude -p <prompt> --permission-mode acceptEdits [--model M] [--allowedTools ...]` | Edits files in the worktree. Shell commands need an `allow` rule such as `Bash(npm test)`. |
| Codex CLI | `codex` | `codex exec --sandbox workspace-write [-m M] -o <result.md> <prompt>` | Sandboxed: edits and runs commands inside the worktree, no network. `--full-auto` no longer exists. |
| Gemini CLI | `gemini` | `gemini -p <prompt> --approval-mode auto_edit [-m M]` | Auto-approves edits. Shell tools need approval and are denied headless. |
| Antigravity CLI | `agy` | `agy -p <prompt> --mode accept-edits --output-format text` | Shell tools stay denied headless unless the user's `settings.json` pre-approves them. |
| GitHub Copilot CLI | `copilot` | `copilot -p <prompt> -s --no-ask-user --allow-tool="write, <allow...>" [--model M]` | Writing allowed, anything else only if listed in `allow`, for example `shell(npm test)`. |

## Notes

- **Gemini CLI vs Antigravity CLI.** Both exist and are detected separately (`gemini` and `agy`). Use whichever the user has logged in.
- **Subscriptions.** Each CLI uses the login the user already has. Playmaker stores no credentials and calls no API directly. Quota is the user's quota, so say how many workers you are about to start.
- **Choosing a provider per task.** Prefer the CLI the user said they want for that kind of work. Without a preference, spread tasks across the CLIs that are installed so no single quota takes all the load, and put tasks that need to run shell commands (tests, builds) on a provider whose default mode allows it (Codex in `workspace-write`, or Claude Code with an `allow` rule).
- **Bypass flags are the user's call.** By default no provider is launched with `--yolo`, `--dangerously-skip-permissions`, `danger-full-access` or `--allow-all-tools`. Claude Code and Codex can call other agents through Bash, and a user may well want `agy --dangerously-skip-permissions` for a trusted task. That works: the user names the flag and it goes in that task's `extraArgs`. The manager never adds one on its own initiative, and offers it only as an option when a worker is blocked by permissions. A per-provider "unsafe mode" setting in the plugin options is possible as a later addition, but it is not built.
- **Models.** `model` is optional per task. Leave it empty to use the CLI's default. Antigravity has no model flag in the launcher; `extraArgs` can carry one if the user's version has it.
- **Windows.** Most CLIs installed through npm are `.cmd` shims, so the launcher runs them through `cmd.exe` with each argument quoted. Avoid `%` and `^` in `allow` rules and models. Test with `board start --dry-run` first.
- **Not verified here.** `--approval-mode` values for Gemini other than `auto_edit`, the exact quoting of `shell(...)` rules in Copilot on Windows, and Antigravity permission rules. These come from docs and secondary sources, not from a run on the user's machine.

## Adding a provider

Add an entry to `PROVIDERS` in `scripts/lib/providers.mjs` with `label`, `bin` and a `build()` that returns the argument array. Keep it in its safest "edit but ask before anything else" mode. If the CLI can write its final answer to a file, set `resultFile: true` and use `resultPath`; otherwise the supervisor copies stdout into `result.md`.
