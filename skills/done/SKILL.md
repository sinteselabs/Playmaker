---
name: done
description: Marks Playmaker tasks the user has tested as Done. The only way a task reaches Done is the user running this.
disable-model-invocation: true
argument-hint: "<task...> | all"
---

# Playmaker: mark tested tasks as done

Talk to the user in their own language. Run commands from the main worktree. `board` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs"`.

What the user typed: $ARGUMENTS

Only the user promotes a task to Done, and running this command is how they say it. Promote only tasks that are at `to_test`.

1. If nothing was typed, run `board totest` and show the tasks at `to_test` with how to test each, then ask which ones were tested.
2. `all` means every task at `to_test`. Name them back to the user before promoting, in the same message as the result.
3. For each task: `board set <task> done --confirmed-by-user`. If one is not at `to_test`, skip it and say what status it has.
4. Report what is now Done and what is still at `to_test`.
