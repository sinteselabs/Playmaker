# Worker brief template

A worker starts with an empty context. Everything it needs has to be in the brief or reachable from it.
Keep it under one page. Replace every angle-bracket field.

The launcher appends a block of Playmaker rules to every brief (work only in the worktree, commit on the branch, never merge, push or switch branches, do not start other agents, stay in scope, run the gates, and what the report must contain). Do not repeat those rules in the brief. When a task is retried after a failed round, the launcher also appends what went wrong.

```markdown
# Task: <one line, imperative>

## Goal
<What must be true when you are done, in two or three sentences. Say why it matters if that changes decisions.>

## Scope
- You own: <files or folders this worker may edit>
- Do not touch: <files or folders other tasks own, shared config, lockfiles>
- If the task needs a change outside your scope, do not make it. Describe it in your report.

## Context
- Read first: <paths to specs, ADRs, conventions, the entry file of the module>
- Already merged and available to you: <what the tasks you depend on delivered>
- Running in parallel: <one line per other task, so this one knows what not to duplicate>
- Constraints: <stack, style rules, things the project forbids>

## How to check your own work
<The exact command(s): tests, type check, lint. Say which must pass.>
```

## What the report must contain

The launcher asks for these, so the manager can verify instead of trusting:

1. What you built (one line per file or behavior).
2. The commit hash.
3. Every gate you ran, with a short summary of its real output.
4. What you could not do or did not verify.
5. Any decision you took that the user would normally take.

The manager treats the report as a claim and checks the diff and the gates itself.

## Rules of thumb

- One task, one outcome. If the goal needs "and", it may be two tasks.
- Name files, not areas. "src/api/users.ts and its test" beats "the users API". The `owns` field of the board uses the same paths.
- State the check. A worker that cannot verify its work will report success anyway.
- Say what is already merged. A task that depends on another starts from the base branch with that work in it, and the brief should name it.
- If Lore tools are available in the worker's session, you may add to Context: `Also write your report to the Lore page playmaker/<run>/<task-id> (kind: fact, expires in 7 days).` The file `result.md` stays the guaranteed channel.
