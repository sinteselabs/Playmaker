---
name: merge
description: Reviews one delivered Playmaker task and integrates it - rebase on the base branch, the gates run by the manager, fast-forward merge - or sends it back with the reason.
disable-model-invocation: true
argument-hint: "<task>"
---

# Playmaker: review and merge one task

Talk to the user in their own language. Run commands from the main worktree. `board` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs"`.

Task: $ARGUMENTS

1. `board sync`, then `board show --json`. If no task was named, list the `delivered` ones and ask which; if there is exactly one, use it. If the named task is not `delivered`, say what status it has and stop.
2. Review before merging, as the manager would:
   - the worker's report, `.playmaker/runs/<run>/<worker>/result.md` (a claim, not proof);
   - `git diff --stat <base>...<branch>` and the diff of the files that matter;
   - whether every changed file is inside the task's `owns` (and `shared`);
   - unless the change is a few lines, the plugin's reviewer agent (`sintese-playmaker:reviewer`, through the Agent tool) with the task id, the brief and report paths, the branch, the base and the task's `owns`. Show its verdict and findings with yours.
3. Tell the user in a few lines what the change does and anything wrong you found.
   - If something is clearly wrong or out of scope, ask whether to send it back. On yes: `board reject <task> --note "<the specific problem>"`.
   - Otherwise integrate: the user typing this command is the approval.
4. `board integrate <task>`. It rebases, runs the board's gates in the worktree, fast-forwards the merge, sets the task to `to_test` and cleans up. On a board with `"integration": "pr"` it pushes the branch and opens a pull request instead, and the task waits `in_review` until the PR is merged on GitHub; exit 4 means the push or `gh` failed and nothing was counted. Exit 3 means it failed: the round is counted and the task goes back to `rework` (or `refix` after two rounds). Show the failing stage and the end of its output.
5. Close with the commit, and the tasks this merge unblocked (`board ready`). If a run is active in this session, the loop continues from here; otherwise mention `/sintese-playmaker:go` to start them.

Never resolve a failure by editing the code yourself: a failed integration goes back to a worker.
