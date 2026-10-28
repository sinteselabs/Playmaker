---
name: scorecard
description: Shows how each agent CLI has done in this repository's Playmaker runs - tasks merged, merged on the first round, parked, average rounds, median minutes - and the last run's retrospective, optionally saved to Lore.
disable-model-invocation: true
argument-hint: "[--save]"
---

# Playmaker: how each provider has done here

Talk to the user in their own language. Run commands from the main worktree. `board` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs"`.

Options typed: $ARGUMENTS

1. `board scorecard`. It reads `.playmaker/scorecard.json`, which every merge and every task parked as ReFix adds to, across runs. If it is empty, say so: it fills as runs finish tasks.
2. Show it as a short table per provider (and per provider and kind, where tasks had a `kind`). Point out what stands out, and how many tasks it rests on: three tasks are not a trend.
3. If there is a board with a run, add the last run's numbers from `board retro --json` in one or two lines.
4. With `--save`, or if the user asks: when Lore tools are available, write the scorecard (`board scorecard`, the Markdown) with `memory_write_page` at `playmaker/scorecard.md`. Without Lore, say it lives in `.playmaker/scorecard.json`.

This command only reads, apart from the Lore page the user asked for.
