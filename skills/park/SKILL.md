---
name: park
description: Takes one Playmaker task out of the run for now (postponed), stopping its worker first if it is running, with an optional note on why.
disable-model-invocation: true
argument-hint: "<task> [why]"
---

# Playmaker: park a task

Talk to the user in their own language. Run commands from the main worktree. `board` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs"`.

What the user typed: $ARGUMENTS

The first word is the task id; the rest, if any, is why it is parked.

1. If no task was named, run `board report` and ask which.
2. If the task is `in_progress`, its worker has to stop first, and whatever it did so far is discarded with its worktree. Say so and ask once to confirm, then `board stop <task>`.
3. `board set <task> postponed --note "<why>"` (use "parked by the user" when no reason was given).
4. Tell the user which tasks depend on it and will now wait (`board ready` lists them as held), and that `/sintese-playmaker:retry <task>` brings it back.
