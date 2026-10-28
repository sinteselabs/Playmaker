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

## Commands

Every command is `/sintese-playmaker:<name>`.

| Command | What it does |
|---|---|
| `plan [file, spec or goal]` | Splits the work into tasks that can run side by side, proposes who does each one, and writes the board once you agree. Takes a Blueprint plan as it is. Also offers itself when it notices a good split. |
| `go` | Starts the run, or resumes it in a new session: starts every task that can safely run, integrates each delivery, starts what it unblocks, and reports at the end. |
| `board` | Where things stand: what is running and for how long, what was delivered, what waits and why, what is at To test. |
| `merge <task>` | Reviews one delivery and merges it after the gates pass, or sends it back with the reason. For when you want to approve each merge. |
| `retry <task> [note]` | Brings back a parked or failed task with a fresh count. The note goes into the next worker's brief. |
| `park <task> [why]` | Takes a task out of the run for now, stopping its worker if it is running. |
| `totest [--save]` | Everything merged that you still have to test, with how to test each: what to run or open, and what you should see. |
| `done <task...> \| all` | Marks tasks you tested as Done. Nothing else ever marks a task Done. |
| `stop [task...]` | Stops running workers and cleans up their worktrees and branches. The board stays, so `go` picks up later. |
| `scorecard [--save]` | How each agent CLI has done in this repository: tasks merged, on the first round, parked, rounds, minutes. `--save` copies it to Lore. |
| `doctor [--gates] [--smoke]` | Checks node, git, the board and every agent CLI. `--gates` runs your gates in a fresh worktree; `--smoke` proves each CLI is logged in. Also says whether Lore is connected. |

And `/playmaker` shows or hides the live board.

## The live board

A pane beside the conversation that shows the run as it happens: what is
running, with which CLI and for how long; what was delivered and waits for
review; what comes next and why it waits; what was parked; what is at To test.
Each row has the button that fits it (Merge, Retry, Done), and the footer has
Go, Stop and Report.

```
Playmaker ──────────────────────────────────────────────
2 of 6 merged · base main · up to 3 at once

Running (1)
● api    Codex CLI · 7 min
Delivered, to review (1)
◆ ui     by Gemini CLI                          [ Merge ]
Next (1)
○ docs   waiting for api to be merged
Parked (1)
✗ cache  gate failed: npm test                  [ Retry ]
To test (1)
✓ auth   merged abcdef1                         [ Done ]

1 done

s: Stop   r: Report
```

It opens by itself when a run starts (the **Live board** option turns that
off), and `/playmaker` shows or hides it at any time. While it is closed, one
line above the prompt sums up the run: `Playmaker: 1 running · 1 to review`.
A toast tells you when a worker delivers.

The pane only reads `.playmaker/`. Every button runs one of the commands above,
exactly as if you had typed it, so the manager agent still does the review and
is still the only one that changes the board. It is a Claude Code
[mod](https://code.claude.com/docs/en/plugins/mods/overview), so it shows in the
terminal, the desktop app and the VS Code extension, not on claude.ai or in
Cowork.

## What it does

**Notices.** A hook counts the open tasks in the session (`TaskCreate`,
`TaskUpdate`, `TodoWrite`). Past a threshold (4 by default) it adds one short,
factual note to the context. That is only a nudge. The `plan` skill decides
whether a parallel run is worth it, and it also triggers on its own when you
talk about parallel agents, multi-agent work or orchestration.

**Offers, once.** The skill checks that the tasks are independent (different
files, clear dependencies, big enough to be worth a worker). If they are, it
sends one message with the split, a suggested provider per task, the cost, the
merge policy (automatic when the gates pass, or ask before each merge) and
whether the run is autonomous. Nothing starts without your "yes", unless you
already said "parallel run" or typed `/sintese-playmaker:plan`. If you say no,
it drops that plan.

**Builds the board.** `.playmaker/board.json` holds the tasks, the files each
one owns (`owns`), dependencies, shared files, exclusive resources and the
project's gates.

**Runs the loop (the `go` skill).**

1. `board ready` computes the batch: tasks whose dependencies are merged and
   that collide with nothing running (files, shared files, resources), up to the
   worker cap (4 by default).
2. `board start` creates one worktree and branch per task and starts each worker
   in the background.
3. The plugin's monitor watches the workers and tells the manager the moment
   one delivers or fails, so nothing polls in the conversation.
4. The manager reads the report, checks the real diff with the plugin's
   reviewer agent (scope, the task's "done when", what breaks quietly), sends
   it back with `board reject` if it is wrong, and runs `board integrate`:
   rebase on the current base, gates run by the manager itself, fast-forward
   merge, status `To test` with the "How to test" the worker reported,
   worktree and branch removed.
5. If that fails, the task goes back for rework with the reason in its brief.
   After two failed rounds it is parked as `ReFix`, and the manager does not try
   to fix it.
6. A delivery unblocks new tasks, which start right away. When nothing is
   running or ready, the manager gives you the final report (and sends a push
   notification if the tool is available).

The manager never implements a delegated task. Only the manager merges. Only
you promote a task to `Done`.

**Two lighter tiers**, when a board is overkill: native subagents (Claude only,
no board) and agent teams (Claude Code teammates that message each other,
experimental, needs `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`).

## From a Blueprint plan

A project that went through [Blueprint](https://github.com/sinteselabs/Blueprint)
already has its tasks: a plan by phase, and one spec per task that says what it
does, what it does not, and when it is done. `/sintese-playmaker:plan
docs/plan.md` turns that into a board. `board import` drafts it (one task per
spec, the spec as the worker's brief, each phase after the one before), and the
manager completes what a plan cannot say: the code each task edits, the
provider, the gates, and which tasks of the next phase do not need all of the
previous one, which is where the parallelism comes from. Each worker fills in
its spec's delivery sections, so the plan stays the project's record.

It reads the plan in whatever language Blueprint wrote it: a task is a numbered
line that names its spec in backticks.

## What is left to test

Every worker ends its report with how to test what it built, and the manager
keeps it with the task when it merges (or writes one from the diff when the
report has none). `/sintese-playmaker:totest` lists everything at To test as a
checklist you can follow in one sitting, the live board shows the first line
of each, and with Lore the list is saved as a page you can come back to.
`/sintese-playmaker:done` marks what you tested.

## What the tools already do, and what Playmaker adds

The native multi-agent features start agents of their own provider: Codex
subagents inherit the session's provider, and Claude Code agent teams only start
Claude teammates. With Bash allowed, either one can call another CLI and use it
as a worker. Playmaker does not create that ability, it organises it: a task
board, collision-free batches, one worktree and branch per worker, background
execution with a monitor, gates run by the manager, merges that never rewrite
history, retries and `ReFix`, and commands to steer all of it.

## Quick start

Requires Node 22 or newer and git.

### 1. Claude Code plugin (recommended)

```bash
claude plugin marketplace add sinteselabs/Playmaker
claude plugin install sintese-playmaker@sinteselabs-playmaker
```

From inside a session: `/plugin marketplace add sinteselabs/Playmaker`, then
`/plugin install sintese-playmaker@sinteselabs-playmaker`. This is the only way
that brings the hooks and the monitor, so it is the only way the agent offers a
parallel run on its own and hears about deliveries as they happen.

Then run `/sintese-playmaker:doctor` once in your project.

On install it asks three things (also under `/config`):

- **Proactive offers**: turns the automatic nudge on or off. With it off the
  commands still work on demand.
- **Open tasks before nudging**: how many open tasks trigger the note (2 to 20).
- **Live board**: whether the board pane opens by itself when a run starts.

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

It copies every skill with a `playmaker-` prefix (`playmaker-plan`,
`playmaker-go`, `playmaker-board`, ...) into `.claude/skills/` and
`.agents/skills/`, and the reviewer agent into `.claude/agents/` (`--agent claude|codex|antigravity` for one only, `--dry-run`
to see what it would write). It never overwrites a file that is already there.
The copies call the board through `npx playmakerlabs@<version>`, pinned to the
version that wrote them. Hooks and monitors are Claude Code plugin features, so
with the CLI the skills work on demand and the manager waits with `board wait`.

## Under the commands

The commands are thin: the deterministic work is in `board.mjs` and
`doctor.mjs`. From the plugin they run as
`node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" ...`; from the CLI, as
`npx playmakerlabs board ...`.

```
board validate                 checks the board (ids, deps, cycles, ownership collisions)
board show [--json]            state of every task
board ready [--json]           what runs now, and why the rest is held
board start [--dry-run]        starts the batch
board sync                     folds finished workers into the board
board watch                    the monitor: one line per delivery or failure, never exits, never writes
board wait [--timeout-min N]   waits for a delivery or a failure, where there is no monitor
board integrate <task>         rebase, gates, ff-only merge
board reject <task> --note ".." sends a delivery back for rework, with the reason
board retry <task> [--note ".."] re-arms a parked or failed task
board stop [task...]           stops workers, removes their worktrees and branches
board set <task> <status> [--note ".."] [--confirmed-by-user]
board report [--json]          summary for the user
board recall [task...]         words to search project memory with, per task
board context <task> --file F  what the project knows, added to the task's next brief
board page                     the run's page for Lore, as JSON
board retro [--json]           what happened in the run, per task
board scorecard [--json]       how each provider has done in this repository
board import <plan.md> [--write] [--provider id]   a draft board from a Blueprint plan
board howto <task> --file F    how to test a task (integrate takes it from the report)
board totest [--json]          everything at To test, with how to test each
doctor [--gates] [--smoke [ids]] [--json]
status [run] [--json] [--overlap]   per-worker view
detect                         which agent CLIs are installed
```

The board format is in
[`skills/plan/references/board.md`](skills/plan/references/board.md).
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
  `.git/info/exclude`. No worktree or branch is left behind after a merge or a
  stop.
- **The monitor and the live board only read.** Neither changes the board, so
  neither can race a merge. The board's buttons run the same commands you can
  type. Outside a git repository the monitor exits at once.
- **Nothing is pushed** to a remote unless you ask.

The command line of each CLI and its caveats are in
[`skills/plan/references/providers.md`](skills/plan/references/providers.md).

## Project memory with Lore

[Lore](https://github.com/akitaonrails/ai-memory) is shared memory on top of
files and git, never a requirement. When its tools are connected, the offer asks
whether to use project memory for the run (yes by default), and then:

- **Before each worker starts, it learns what the project already knows.** The
  manager searches Lore with words taken from the task (its id, title and the
  files it owns), keeps the decisions, gotchas and rules that apply, and puts
  them in the brief under "What this project already knows". The worker gets
  them even when its own CLI has no Lore.
- **The run is visible to the team** as a page in Lore that the manager keeps
  current and that expires a week later. Workers whose CLI has Lore declare
  their own work page, as the team's parallel-run rule asks.
- **At the end, the run is remembered**: a retrospective (what merged, on which
  round, what went wrong) and the provider scorecard go to Lore, and the manager
  offers to turn a repeated problem into a gotcha page.
- **The team's own `parallel-run` rule** is read first and followed where it
  differs from the plugin's defaults.

Two things work without Lore. The **scorecard** lives in
`.playmaker/scorecard.json` and fills on its own as tasks merge or get parked,
so `/sintese-playmaker:scorecard` and the provider suggestions in the offer use
it either way. And when a session ends mid-run, the next one in that repository
**is told the run is unfinished** and how to resume it; with Lore, the manager
can also leave a handoff.

The scripts do the deterministic part (`board recall`, `context`, `page`,
`retro`, `scorecard`) and print what to write; only the manager agent calls
Lore. The details are in
[`skills/plan/references/coordination.md`](skills/plan/references/coordination.md).

## Known limits

- **Gates in a fresh worktree.** Gates run in a newly created worktree, so they
  must include installing dependencies (for example `npm ci && npm test`).
  Without it, every integration fails. `/sintese-playmaker:doctor --gates`
  shows this before the first run.
- **No board writes during `wait`.** Where there is no monitor and the manager
  waits with `board wait`, do not run `integrate`, `start` or `set` meanwhile.
  Read-only commands (`show`, `ready`, `report`) are fine.
- **Flags not yet verified in a real run**: Gemini `--approval-mode` values
  other than `auto_edit`, the quoting of Copilot `shell(...)` rules on Windows,
  and Antigravity permission rules. They are marked in `providers.md`.
- **Merge policy and autonomous mode** are followed by the manager (they are in
  the board and the skill), not enforced by the script.
- **A per-provider "unsafe" option** does not exist yet. The bypass flag is per
  task, in `extraArgs`.
- **Codex.** The skills follow the Agent Skills format and install with
  `npx playmakerlabs init`, but the hooks, the monitor and the live board are
  Claude Code only, and the Codex side has not been tested end to end.
- **The live board needs mods.** Mods load in Claude Code 2.1.287 or later, in
  a workspace you trusted. They do not load with `--safe-mode`, `--bare` or
  `disableAllHooks`, and an organization can turn them off in managed settings.
  Without them, everything else works and `/sintese-playmaker:board` shows the
  same state in the conversation.

## Tests

```bash
npm test             # the CLI: init, passthrough, help, version
npm run test:e2e     # the full loop, the launcher, and what the commands stand on
```

Both run on Windows, macOS and Linux, with fake agent CLIs written in Node
(`tests/lib/fakes.mjs`). The board test runs six tasks with dependencies, a
collision and a shared file, makes a gate fail and the task get redone, and
checks that at the end everything is at `To test`, main is clean and no worktree
or branch is left. The smoke test covers the single-batch launcher, the hooks
and the validation errors. The commands test covers the monitor (one line per
delivery, never a write), `sync`, `reject`, `stop`, `retry`, a report without a
board, and the doctor with its gates and smoke checks. The memory test covers the
search words, the context in the brief, the run's page, the retrospective, the
scorecard, and the session start note about an unfinished run. The
integrations test imports a Blueprint plan written in Portuguese, runs two of
its tasks, and checks the "How to test" they carry into the list.

```bash
claude plugin test          # the live board pane, with no session (tests/panel.test.ts)
claude plugin validate .    # the manifest and the hooks module, as Claude Code reads them
```

CI runs all of them on every change.

## Layout

```
.claude-plugin/plugin.json          manifest and options
hooks/hooks.json                    SessionStart and PostToolUse, and the live board's module
hooks/panel.js                      the live board: pane, line above the prompt, /playmaker
monitors/monitors.json              the monitor that announces deliveries
agents/reviewer.md                  reviews a delivery against its brief before the merge
skills/plan/                        when to offer, how to offer, how to build the board
skills/plan/references/             board, brief, providers, coordination and Lore
skills/go/                          the manager loop
skills/board, merge, retry, park, totest, done, stop, scorecard, doctor/   the commands
scripts/board.mjs                   board: ready, start, sync, watch, integrate, reject, retry, stop, report
scripts/doctor.mjs                  setup checks, gates in a fresh worktree, smoke test per CLI
scripts/spawn.mjs                   worker supervisor and single-batch launcher
scripts/status.mjs                  worker state and file overlap
scripts/detect-agents.mjs           detects installed CLIs
scripts/task-watch.mjs              counts open tasks and gives the nudge
scripts/lib/model.mjs               board defaults, collisions and the ready set, shared with the pane
scripts/lib/report.mjs              search words, the run's page, retrospective, scorecard, to-test list
scripts/lib/blueprint.mjs           reads a Blueprint plan and its specs
scripts/lib/launch.mjs              worktree, brief and start of each worker
scripts/lib/providers.mjs           how each CLI is started
cli/playmaker.mjs                   the npm CLI: init and the scripts above
tests/                              end-to-end and CLI tests
tooling/make_icon.py                draws .claude-plugin/icon.png (not part of the product)
```

## License

[MIT](LICENSE), by Síntese Labs.
