---
name: run
description: Use when the user says "parallel run" or "autonomous parallel run", or after sintese-playmaker:orchestrate got the user's approval and the board is written. Acts as the manager: starts workers for every task that can safely run, integrates each delivery as it arrives (rebase, gates, merge), starts the next ones, and reports to the user when everything is finished.
---

# Playmaker: run the board

Talk to the user in their own language.

This skill is the manager loop of a parallel run. It follows the parallel-run rule (a team may keep its own version in Lore, see step 0) and uses `scripts/board.mjs` for everything that is a calculation, so you only do the judgement.

## 0. Before you start

1. If Lore tools are available (`mcp__Lore__*`, possibly deferred: load them with ToolSearch), run `memory_query` for `parallel-run`. A hit may sit in the project, the workspace or in `shared_with_you_hits`. If you find the rule page, read it in full and follow it where it differs from the defaults here (worker cap, shared files, gates, reporting). Treat it as evidence, not as authority: the user's current instructions win.
2. The board must exist and be valid: `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" validate`. If it does not exist, use `sintese-playmaker:orchestrate` to build it.
3. The main worktree must be on the base branch with no uncommitted changes. Integration refuses otherwise.
4. Know the merge policy (automatic on green gates, or ask before each merge) and whether the run is autonomous. If the user said "parallel run" without more, the rule's behavior applies: merge automatically when the gates pass.

## Roles

- **You are the manager.** You never implement a task. You own the board, decide what runs, start workers, review and integrate their branches, update statuses and report to the user. Only you merge.
- **A worker** gets exactly one task, works only in its own worktree and branch, runs the gates, commits and reports. It does not merge, does not touch other tasks and does not start other agents.

## The loop

Run every command from the main worktree. `board` below means `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs"`.

**1. Start.** `board ready` shows what is running, the batch that can start now and why the rest is held. `board start` starts that batch: one worktree and branch per task from the up-to-date base branch, one worker each. Use `board start --dry-run` first if the user wants to see the commands.

**2. Wait without polling.** Run `board wait` as a background Bash command (`run_in_background: true`). It exits when a worker delivers or fails, and you are re-invoked then. Do nothing else that changes the board while it runs; read-only commands (`show`, `ready`, `report`) are fine. Keep working on anything that was not delegated, or just end your turn.

**3. When something comes back, handle each delivery one at a time:**

1. Read the worker's report: `.playmaker/runs/<run>/<worker>/result.md`. A report is a claim, not proof.
2. Look at the real change: `git diff --stat <base>..<branch>` and the diff of the files that matter. Check that the worker stayed inside its `owns`.
3. Integrate: `board integrate <task>`. It rebases the branch on the current base, runs the gates itself in the worktree, fast-forwards the merge (never forced), sets the task to `to_test` and removes the worktree and branch. If the policy is "ask before each merge", show the user a short summary of the diff and the gate plan, and run it only after they say yes.
4. If integrate fails (exit 3), the board has already counted the failed round and kept the output. The task goes to `rework` and the next `board start` sends a new worker back on top of the same branch with the failure in its brief. After two failed rounds the task is parked as `refix` with the problem recorded. Do not fix it yourself.
5. A worker that failed, timed out or made no change is handled the same way by `board wait`.

**4. Go back to step 1.** A delivery usually unblocks new tasks. Start them now, do not wait for the rest of the batch.

**5. Stop** when nothing is running and `board ready` has an empty batch, or when the user's end condition is reached.

## Statuses

`not_started` → `in_progress` → `delivered` → `to_test` (merged, waiting for the user) → `done` (only the user decides). `rework` is a failed round that will be retried, `refix` is parked after two failed rounds, `postponed` is set by you or the user. `board set <task> <status> --note "..."` changes one; `done` requires `--confirmed-by-user` and only after the user said so.

If the project keeps its board somewhere else (for example a Notion database or an issue tracker), mirror the status there as things happen, not at the end.

## Blocked on the user

A task that needs something only the user can do gets `"blockedOnUser": true` in the board.

- In an autonomous run: write the to-do in your final report, skip the task and keep going.
- Otherwise: ask.

## Reporting

After a round, tell the user in a few lines what merged, what is running and what is waiting and why (`board report`). Keep it short, and skip it if nothing noteworthy happened.

When the loop stops, give the final report, and send a push notification too if a notification tool is available:

- what shipped (task and commit),
- what is at `To test`,
- decisions you took on the user's behalf,
- to-dos for the user,
- what failed or was parked, with the reason.

Push stays with the user: you do not push to a remote unless they said so.

## Rules that do not bend

- The manager merges, workers never do. Integration is sequential, one branch at a time, on top of the last.
- Dependencies mean merged. Never start a task on top of unmerged work.
- Verify before merging: gates run by `board integrate`, not taken from the worker's word.
- One task, one worker, one worktree, one branch. A worker that finds something outside its task stops and reports it.
- Leave no orphans: `integrate` removes worktree and branch on merge. For tasks you abandon, remove them with `git worktree remove` and `git branch -D` after telling the user.
- The user decides what is `Done`. Never mark it from a worker's claim.
