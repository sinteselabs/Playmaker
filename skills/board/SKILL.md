---
name: board
description: Shows where the Playmaker run stands - what is running and for how long, what was delivered, what is waiting and why, what is at To test and what was parked.
disable-model-invocation: true
---

# Playmaker: where things stand

Talk to the user in their own language. Run commands from the main worktree of the repository.

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" report`. It folds finished workers into the board first, so what it prints is current.

Show the result as one short table: task, status, and the detail that matters for that status (provider and minutes while running, commit once merged, the reason when held, rework or parked). Statuses in the user's words: running, delivered (waiting to be integrated), in review (a pull request is open, with its link), to test, done, rework, parked (refix), postponed, not started.

Then, only where it applies, one line each on what the user can do next:

- something `delivered` and the run is not active in this session: `/sintese-playmaker:go` integrates it, or `/sintese-playmaker:merge <task>` for one;
- something at `to_test`: `/sintese-playmaker:done <task>` once they have tested it;
- something parked (`refix`) or `postponed`: `/sintese-playmaker:retry <task> [note]`;
- nothing on the board yet: `/sintese-playmaker:plan`.

Do not start, integrate or change anything: this command only reads.
