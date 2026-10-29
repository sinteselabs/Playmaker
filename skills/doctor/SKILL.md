---
name: doctor
description: Checks that a Playmaker run can work here - node, git, the repository, the board, which agent CLIs are installed and their versions, optionally the gates in a fresh worktree and whether each CLI is logged in - and whether Lore is connected.
disable-model-invocation: true
argument-hint: "[--gates] [--smoke [claude,codex,...]]"
---

# Playmaker: check the setup

Talk to the user in their own language.

Options typed: $ARGUMENTS

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.mjs" $ARGUMENTS` from the repository (exit 1 means a check failed; the output says which). On a board that opens pull requests, it also checks the `origin` remote and that `gh` is installed and logged in.
   - `--gates` runs the board's gates in a fresh worktree of the base branch. That is the environment integration uses, so a gate that fails here will fail every merge: usually a missing install step (`npm ci && ...`).
   - `--smoke` sends each installed CLI (or the listed ones) a one-line prompt, to prove it is logged in. It spends a little of each provider's quota, so run it only when the user asked for it.
2. Check Lore yourself, since a script cannot see this session's tools: are `mcp__lore__*` (or `mcp__Lore__*`) tools available, possibly deferred? If so, say Lore is connected, and whether `memory_query` finds a `parallel-run` rule for this project. Lore is optional: without it the run works from files and git.
3. Show the result grouped: what is ready, what is a warning, what fails. For each failure or warning, give the one fix that resolves it (install a CLI, log in, switch to the base branch, commit, add an install step to a gate).
4. If the gates or the smoke test were not run, offer them in one line.
