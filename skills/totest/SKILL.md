---
name: totest
description: Lists everything a Playmaker run merged that the user still has to test, with how to test each - what to run or open and what should be seen - optionally saved to Lore.
disable-model-invocation: true
argument-hint: "[--save]"
---

# Playmaker: what is left to test

Talk to the user in their own language. Run commands from the main worktree. `board` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs"`.

Options typed: $ARGUMENTS

1. `board totest`. It lists every task at To test: merged by the manager, waiting for the user to try it. Each comes with the "How to test" its worker reported, or the one the manager set with `board howto`.
2. Show it as a checklist the user can follow in one sitting: per task, what to run or open, how long it takes when that is clear, and what should be seen. Group tasks that are tested together. Where a task has no how-to-test, read its diff and propose one, and set it with `board howto <task> --file <file>` once the user agrees.
3. A task from a Blueprint plan names its spec: its delivery sections should say the same; mention it if they do not.
4. With `--save`, or if the user asks: when Lore tools are available, write the list (`board totest`, the Markdown) with `memory_write_page` at `playmaker/to-test.md`.
5. Close with: `/sintese-playmaker:done <task>` (or `all`) once they are tested.
