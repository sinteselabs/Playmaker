---
name: stop
description: Stops running Playmaker workers (all of them, or the tasks named), removes their worktrees and branches, and keeps the board so the run can resume later.
disable-model-invocation: true
argument-hint: "[task...]"
---

# Playmaker: stop workers

Talk to the user in their own language. Run commands from the main worktree. `board` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs"`.

Tasks named: $ARGUMENTS

1. `board report`. If nothing is running, say so and stop here.
2. Name the workers that will stop (all running ones, or only the tasks named) and say that what they did so far is discarded with their worktrees and branches. Ask once to confirm.
3. On yes: `board stop` (or `board stop <task> <task>...`). The stopped tasks go back to `not_started` and keep their place on the board. Delivered and merged work is not touched.
4. Report what stopped. Say that `/sintese-playmaker:go` starts them again, and `/sintese-playmaker:park <task>` takes one out of the run instead.

If a run loop is active in this session, it ends here unless the user asks to go on.
