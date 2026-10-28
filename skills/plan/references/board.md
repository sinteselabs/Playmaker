# The board

`.playmaker/board.json` in the main worktree of the repository. The folder is excluded from git automatically.
`board.mjs validate` checks everything below, including dependency cycles.

## Format

```json
{
  "base": "main",
  "cap": 4,
  "timeoutMin": 30,
  "mergePolicy": "auto",
  "autonomous": false,
  "gates": ["npm ci && npm run lint", "npm test"],
  "sharedFiles": ["package.json", "package-lock.json", "src/router.ts"],
  "tasks": [
    {
      "id": "db",
      "title": "Users table and migration",
      "provider": "codex",
      "brief": "# Task: ...\n(see brief-template.md)",
      "owns": ["src/db/", "migrations/"],
      "shared": ["package.json"],
      "resources": ["local-postgres"],
      "deps": []
    },
    {
      "id": "api",
      "title": "GET /users with pagination",
      "provider": "claude",
      "model": "",
      "allow": ["Bash(npm test)"],
      "extraArgs": [],
      "brief": "# Task: ...",
      "owns": ["src/api/users.ts", "src/api/users.test.ts"],
      "deps": ["db"]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `base` | Branch workers start from and merges land on. Default `main`. The main worktree must be on it. |
| `cap` | Workers running at once, 1 to 8. Default 4. Fewer good parallel tasks beat more colliding ones. |
| `timeoutMin` | Per worker. Default 30. A task can override it. |
| `mergePolicy` | `auto` (merge when gates pass) or `ask` (manager asks the user first). Followed by the manager, not enforced by the script. |
| `autonomous` | Blocked-on-user tasks become to-dos instead of stopping the run. Followed by the manager. |
| `integration` | `merge` (default): the manager fast-forwards each delivery into `base` locally. `pr`: integrate pushes the task's branch to `origin` and opens a pull request with `gh`; the merge happens on GitHub, `board sync` reads it, and workers branch from `origin/<base>`. |
| `gates` | Commands run by `board integrate` in the worker's worktree after the rebase. They run in a fresh worktree, so include install steps. They also go into every worker's brief. |
| `sharedFiles` | Files that at most one running task may own: project file, router, entry point, lockfiles, rules files. |
| `lore` | `true` when the user accepted using project memory for this run. The manager then attaches what each task should know, keeps the run's page in Lore and records the retrospective. Workers are asked to declare their own work page if their CLI has Lore. |

Task fields:

| Field | Meaning |
|---|---|
| `id` | Lowercase letters, digits and dashes, up to 31 characters, not ending in `-r<number>` (reserved for retries). |
| `provider` | `claude`, `codex`, `gemini`, `agy` or `copilot`. See `providers.md`. |
| `brief` | Self-contained instructions. See `brief-template.md`. |
| `owns` | Files or folders the task edits. Required. Two tasks whose paths overlap (same file, or one inside the other's folder) never run together. |
| `shared` | Entries of `sharedFiles` the task will edit. Two tasks that need the same one never run together. |
| `resources` | Exclusive things (a port, a local database, an emulator). Same rule. |
| `deps` | Task ids that must be merged first. |
| `blockedOnUser` | `true` while the task needs something only the user can do. The task is held. |
| `model`, `allow`, `extraArgs` | Optional per-worker CLI settings. `extraArgs` is where an explicit flag the user asked for goes. |
| `kind` | Optional label for the kind of work (`tests`, `frontend`, `migration`...). The provider scorecard also counts by provider and kind. |
| `context` | Set with `board context <task> --file notes.md`: what the project already knows that applies to this task. Added to its next brief. |

Fields the script maintains: `status`, `attempts`, `round`, `worker`, `branch`, `worktree`, `branches`, `merged` (commit), `feedback`, `history`, and `pr` (`url`, `branch`, `state`) in pull request mode. The board also gets a `run` id when the first worker starts.

Beside the board, `.playmaker/scorecard.json` outlives every run: each task that merges or is parked as ReFix adds one entry (provider, kind, rounds, failed rounds, minutes to merge). `board scorecard` sums it up.

## Statuses

`not_started`, `in_progress`, `delivered`, `in_review`, `rework`, `to_test`, `refix`, `done`, `postponed`.

`in_review` exists only with `"integration": "pr"`: the task's pull request is open. It takes no worker slot but keeps its files for the collision check, and tasks that depend on it wait for the merge.

These mirror a common task state machine (Not started, In progress, To test, ReFix, Done, Postpone). `delivered` (worker finished, not integrated) and `rework` (failed round, will be retried) are the two extra states the manager loop needs.

A task is **ready** when it is `not_started` or `rework`, every dependency is `to_test` or `done`, it is not `blockedOnUser`, and it does not collide with a running task. The batch is the ready tasks, in board order, that do not collide with each other, up to `cap` minus the tasks already running.

## Limits to know about

- Gates need a working environment inside a fresh worktree. If dependencies are not installed there, every integration fails. Put the install step in the gate.
- Integration needs the main worktree on `base` and clean. It never stashes or commits for you.
- A task whose worker finishes without committing a change counts as a failed round.
