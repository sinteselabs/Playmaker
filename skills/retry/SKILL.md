---
name: retry
description: Re-arms a parked (ReFix), postponed or failed Playmaker task with a fresh attempt count, optionally with a note that goes into the next worker's brief.
disable-model-invocation: true
argument-hint: "<task> [note for the next worker]"
---

# Playmaker: try a task again

Talk to the user in their own language. Run commands from the main worktree. `board` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs"`.

What the user typed: $ARGUMENTS

The first word is the task id. Everything after it, if anything, is a note for the next worker.

1. If no task was named, run `board report` and ask which of the `refix`, `postponed` or `rework` tasks to retry.
2. Run `board retry <task>`, adding `--note "<the note>"` when there is one. The note is put at the top of the next worker's brief, above the last failure. A task that still has its branch resumes on top of it (`rework`); one without starts fresh (`not_started`). The attempt count goes back to zero, so it gets two more rounds.
3. If the previous failure was something only the user could fix (a missing secret, a service down, a decision), ask whether it is fixed now before starting anything.
4. Say what happens next: if a run is active in this session, the task joins the next batch; otherwise `/sintese-playmaker:go` starts it.
