<div align="center">

# 🎯 Playmaker

> **Your agent notices when the work can run in parallel, and offers to manage it.**

A plugin and a set of skills that turn the agent you are talking to into the
manager of a parallel run: it proposes the split, you approve, and workers run
on the agent CLIs you already have installed and signed in (Claude Code, Codex,
Gemini, Antigravity, Copilot), each in its own git worktree and branch.

[![npm](https://img.shields.io/npm/v/playmakerlabs?label=playmakerlabs)](https://www.npmjs.com/package/playmakerlabs)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)](package.json)
[![Agent Skills](https://img.shields.io/badge/format-Agent%20Skills-blue)](https://agentskills.io)

</div>

---

## Who talks to whom

Only the manager talks to the workers, and only through two things: the brief
it hands out and the report it gets back. Workers do not talk to each other and
do not talk to you. The manager talks to you when it makes the offer, when it
needs a decision, and when everything is finished.

```
you  <->  manager (Playmaker)  ->  worker A  (worktree + branch)
                                ->  worker B  (worktree + branch)
                                ->  worker C  (worktree + branch)
```

## What it does

**Notices.** A hook counts the open tasks in the session (`TaskCreate`,
`TaskUpdate`, `TodoWrite`). Past a threshold (4 by default) it adds one short,
factual note to the context. That is only a nudge. The `orchestrate` skill
decides whether a parallel run is worth it, and it also triggers on its own when
you talk about parallel agents, multi-agent work or orchestration.

**Offers, once.** The skill checks that the tasks are independent (different
files, clear dependencies, big enough to be worth a worker). If they are, it
sends one message with the split, a suggested provider per task, the cost, the
merge policy (automatic when the gates pass, or ask before each merge) and
whether the run is autonomous. Nothing starts without your "yes", unless you
already said "parallel run". If you say no, it drops that plan.

**Builds the board.** `.playmaker/board.json` holds the tasks, the files each
one owns (`owns`), dependencies, shared files, exclusive resources and the
project's gates.

**Runs the loop (the `run` skill).**

1. `board ready` computes the batch: tasks whose dependencies are merged and
   that collide with nothing running (files, shared files, resources), up to the
   worker cap (4 by default).
2. `board start` creates one worktree and branch per task and starts each worker
   in the background.
3. `board wait` runs in the background. When a worker delivers or fails, the
   agent is woken up.
4. The manager reads the report, checks the real diff and runs
   `board integrate`: rebase on the current base, gates run by the manager
   itself, fast-forward merge, status `To test`, worktree and branch removed.
5. If that fails, the task goes back for rework with the reason in its brief.
   After two failed rounds it is parked as `ReFix`, and the manager does not try
   to fix it.
6. A delivery unblocks new tasks, which start right away. When nothing is
   running or ready, the manager gives you the final report (and sends a push
   notification if the tool is available).

The manager never implements a delegated task. Only the manager merges. Only
you promote a task to `Done`: `board set <task> done` requires
`--confirmed-by-user`.

**Two lighter tiers**, when a board is overkill: native subagents (Claude only,
no board) and agent teams (Claude Code teammates that message each other,
experimental, needs `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`).

## What the tools already do, and what Playmaker adds

The native multi-agent features start agents of their own provider: Codex
subagents inherit the session's provider, and Claude Code agent teams only start
Claude teammates. With Bash allowed, either one can call another CLI and use it
as a worker. Playmaker does not create that ability, it organises it: a task
board, collision-free batches, one worktree and branch per worker, background
execution, gates run by the manager, merges that never rewrite history, retries
and `ReFix`.

## Quick start

Requires Node 22 or newer and git.

### 1. Claude Code plugin (recommended)

```bash
claude plugin marketplace add sinteselabs/Playmaker
claude plugin install sintese-playmaker@sinteselabs-playmaker
```

From inside a session: `/plugin marketplace add sinteselabs/Playmaker`, then
`/plugin install sintese-playmaker@sinteselabs-playmaker`. This is the only way that
brings the hooks, so it is the only way the agent offers a parallel run on its
own.

On install it asks two things (also under `/config`):

- **Proactive offers**: turns the automatic nudge on or off. With it off the
  skills still work on demand (`/sintese-playmaker:orchestrate`, `/sintese-playmaker:run`).
- **Open tasks before nudging**: how many open tasks trigger the note (2 to 20).

### 2. claude.ai, the desktop app and Cowork

Open **[Customize → Plugins](https://claude.ai/customize/plugins)**, then
**Add → Add marketplace**, and paste:

```
sinteselabs/Playmaker
```

### 3. The CLI, in one project folder

For Codex, Antigravity or any agent that reads skills from the project:

```bash
npx playmakerlabs init
```

It copies the two skills as `playmaker-orchestrate` and `playmaker-run` into
`.claude/skills/` and `.agents/skills/` (`--agent claude|codex|antigravity` for
one only, `--dry-run` to see what it would write). It never overwrites a file
that is already there. The copies call the board through
`npx playmakerlabs@<version>`, pinned to the version that wrote them. Hooks are
a Claude Code plugin feature, so with the CLI the skills work on demand only.

## Board commands

From the plugin they are `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" ...`;
from the CLI, `npx playmakerlabs board ...`.

```
board validate                 checks the board (ids, deps, cycles, ownership collisions)
board show [--json]            state of every task
board ready [--json]           what runs now, and why the rest is held
board start [--dry-run]        starts the batch
board wait [--timeout-min N]   waits for a delivery or a failure (run it in the background)
board integrate <task>         rebase, gates, ff-only merge
board set <task> <status> [--note ".."] [--confirmed-by-user]
board report [--json]          summary for the final report
status [run] [--json] [--overlap]   per-worker view
detect                         which agent CLIs are installed
```

The board format is in
[`skills/orchestrate/references/board.md`](skills/orchestrate/references/board.md).
Statuses: Not started, In progress, To test, ReFix, Done, Postpone, plus
`delivered` (worker finished, not integrated yet) and `rework` (failed round,
will be retried).

`spawn --plan plan.json` is still there as a single-batch launcher, with no
board and no integration (at most 6 workers).

## Safety that is already in the code

- **No CLI starts with a bypass flag**: no `--yolo`,
  `--dangerously-skip-permissions`, `danger-full-access` or `--allow-all-tools`.
  Each CLI's default mode lets the worker edit files in its worktree. If you want
  one of those flags for a task, you name it and it goes in that task's
  `extraArgs`.
- **30-minute timeout per worker**, configurable per board and per task.
- **Integration refuses to run** if the main worktree is not on the base branch
  or has uncommitted changes.
- **The brief never goes on the command line**, only a short prompt telling the
  worker to read `.playmaker/brief.md`. That avoids quoting and length problems
  on Windows.
- **Everything lives in `.playmaker/`**, excluded from git through
  `.git/info/exclude`. No worktree or branch is left behind after a merge.
- **Nothing is pushed** to a remote unless you ask.

The command line of each CLI and its caveats are in
[`skills/orchestrate/references/providers.md`](skills/orchestrate/references/providers.md).

## Lore, optional

[Lore](https://github.com/akitaonrails/ai-memory) is used as shared memory on top
of files and git, never as a requirement. When a run starts, the `run` skill
looks for a `parallel-run` rule with `memory_query` and follows the team's live
rule where it differs from the plugin's defaults. With your "yes", it can also
record the run's plan as a page that expires, leave a handoff if the session
ends before the workers do, and use the inbox when a task belongs to another
repository. The details are in
[`skills/orchestrate/references/coordination.md`](skills/orchestrate/references/coordination.md).

Lore messages go between **projects** and are delivered once, so they are not
part of the loop: the workers of a run belong to the same project and only talk
to the manager.

## Known limits

- **Gates in a fresh worktree.** Gates run in a newly created worktree, so they
  must include installing dependencies (for example `npm ci && npm test`).
  Without it, every integration fails.
- **No board writes during `wait`.** Do not run `integrate`, `start` or `set`
  while a `wait` is active. Read-only commands (`show`, `ready`, `report`) are
  fine.
- **Windows.** The code handles the `.cmd` shims of npm-installed CLIs, but the
  end-to-end tests run on macOS and Linux (the fake CLIs are shell scripts). Run
  `board start --dry-run` on your machine before the first real run.
- **Flags not yet verified in a real run**: Gemini `--approval-mode` values
  other than `auto_edit`, the quoting of Copilot `shell(...)` rules on Windows,
  and Antigravity permission rules. They are marked in `providers.md`.
- **Merge policy and autonomous mode** are followed by the manager (they are in
  the board and the skill), not enforced by the script.
- **A per-provider "unsafe" option** does not exist yet. The bypass flag is per
  task, in `extraArgs`.
- **Codex.** The skills follow the Agent Skills format and install with
  `npx playmakerlabs init`, but the hooks are Claude Code only, and the Codex
  side has not been tested end to end.

## Tests

```bash
npm test             # the CLI: init, passthrough, help, version (Windows, macOS, Linux)
npm run test:e2e     # the full loop and the launcher (macOS, Linux)
```

The end-to-end board test brings up fake CLIs, runs six tasks with
dependencies, a collision and a shared file, makes a gate fail and the task get
redone, and checks that at the end everything is at `To test`, main is clean and
no worktree or branch is left. The smoke test covers the single-batch launcher,
the hooks (silent below the threshold, one note per session, off by
configuration) and the validation errors.

Before a release, also run `claude plugin validate .`.

## Layout

```
.claude-plugin/plugin.json          manifest and options
hooks/hooks.json                    SessionStart and PostToolUse
skills/orchestrate/                 when to offer, how to offer, how to build the board
skills/orchestrate/references/      board, brief, providers, coordination and Lore
skills/run/                         the manager loop
scripts/board.mjs                   board: ready, start, wait, integrate, set, report
scripts/spawn.mjs                   worker supervisor and single-batch launcher
scripts/status.mjs                  worker state and file overlap
scripts/detect-agents.mjs           detects installed CLIs
scripts/task-watch.mjs              counts open tasks and gives the nudge
scripts/lib/launch.mjs              worktree, brief and start of each worker
scripts/lib/providers.mjs           how each CLI is started
cli/playmaker.mjs                   the npm CLI: init and the scripts above
tests/                              end-to-end and CLI tests
tooling/make_icon.py                draws .claude-plugin/icon.png (not part of the product)
```

## License

[MIT](LICENSE), by Síntese Labs.
