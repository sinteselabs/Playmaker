// End-to-end smoke test with fake agent CLIs. Runs on macOS and Linux (the fakes are shell scripts).
// On Windows, test with real CLIs: `node scripts/spawn.mjs --plan plan.json --dry-run` first.
//   node tests/smoke.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = (name) => path.join(ROOT, 'scripts', name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'playmaker-smoke-'));
const repo = path.join(tmp, 'proj');
const bin = path.join(tmp, 'bin');
const data = path.join(tmp, 'data');
fs.mkdirSync(repo);
fs.mkdirSync(bin);

// fake CLIs -------------------------------------------------------------
const fake = (name, body) => {
  const file = path.join(bin, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
};
fake(
  'codex',
  `out=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift;; esac; shift; done
test -f .playmaker/brief.md || { echo "no brief" >&2; exit 3; }
echo codex > codex-was-here.txt
[ -n "$out" ] && echo "codex report" > "$out"
echo "codex stdout"`
);
fake(
  'claude',
  `test -f .playmaker/brief.md || { echo "no brief" >&2; exit 3; }
echo claude > claude-was-here.txt
echo "claude report"`
);

const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CLAUDE_PLUGIN_DATA: data };
const run = (file, args, opts = {}) =>
  spawnSync(process.execPath, [script(file), ...args], { cwd: repo, env, encoding: 'utf8', ...opts });

// repo -----------------------------------------------------------------
const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
g('init', '-q', '-b', 'main');
g('config', 'user.email', 'smoke@example.com');
g('config', 'user.name', 'Smoke');
fs.writeFileSync(path.join(repo, 'README.md'), '# proj\n');
g('add', '-A');
g('commit', '-q', '-m', 'init');

const plan = {
  run: 'rsmoke',
  workers: [
    { id: 'alpha', provider: 'codex', brief: '# Task alpha\nDo alpha.' },
    { id: 'beta', provider: 'claude', brief: '# Task beta\nDo beta.' },
  ],
};
fs.writeFileSync(path.join(tmp, 'plan.json'), JSON.stringify(plan));

// 1. dry run changes nothing ---------------------------------------------
let r = run('spawn.mjs', ['--plan', path.join(tmp, 'plan.json'), '--dry-run']);
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout, /Dry run only/);
assert.equal(g('worktree', 'list').split('\n').length, 1, 'dry run must not create worktrees');

// 2. real launch ------------------------------------------------------------
r = run('spawn.mjs', ['--plan', path.join(tmp, 'plan.json')]);
assert.equal(r.status, 0, r.stderr + r.stdout);

let rows = [];
for (let i = 0; i < 80; i += 1) {
  rows = JSON.parse(run('status.mjs', ['rsmoke', '--json']).stdout || '[]');
  if (rows.length === 2 && rows.every((x) => ['done', 'failed', 'error', 'timeout'].includes(x.state))) break;
  await sleep(250);
}
assert.equal(rows.length, 2);
for (const row of rows) {
  assert.equal(row.state, 'done', JSON.stringify(row));
  assert.equal(row.filesChanged, 1, `${row.id} should have committed one file`);
  assert.ok(fs.readFileSync(row.result, 'utf8').trim().length > 0, 'result.md must not be empty');
  assert.ok(g('branch', '--list', row.branch).includes(row.branch.split('/').pop()), 'branch exists');
}
assert.match(fs.readFileSync(rows.find((x) => x.id === 'alpha').result, 'utf8'), /codex report/);
assert.match(fs.readFileSync(rows.find((x) => x.id === 'beta').result, 'utf8'), /claude report/);
assert.equal(fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8').includes('.playmaker/'), true);
assert.equal(g('status', '--porcelain'), '', 'main tree must stay clean (.playmaker is excluded)');

r = run('status.mjs', ['rsmoke', '--overlap']);
assert.match(r.stdout, /No file was changed by more than one worker/);

// a second launch with the same run id must refuse
r = run('spawn.mjs', ['--plan', path.join(tmp, 'plan.json')]);
assert.notEqual(r.status, 0);
assert.match(r.stderr, /already exists/);

// 3. hooks ------------------------------------------------------------------
const hook = (file, args, payload) => run(file, args, { input: JSON.stringify(payload) });
const todos = (n) => ({
  session_id: 'sess-1',
  tool_name: 'TodoWrite',
  tool_input: { todos: Array.from({ length: n }, (_, i) => ({ content: `t${i}`, status: 'pending' })) },
});
r = hook('task-watch.mjs', [], todos(3));
assert.equal(r.status, 0);
assert.equal(r.stdout, '', 'below threshold stays silent');
r = hook('task-watch.mjs', [], todos(5));
assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /5 open tasks/);
r = hook('task-watch.mjs', [], todos(6));
assert.equal(r.stdout, '', 'only nudges once per session');

const off = spawnSync(process.execPath, [script('task-watch.mjs')], {
  cwd: repo,
  env: { ...env, CLAUDE_PLUGIN_OPTION_PROACTIVE: 'false' },
  input: JSON.stringify({ ...todos(9), session_id: 'sess-2' }),
  encoding: 'utf8',
});
assert.equal(off.stdout, '', 'proactive=false silences the hook');

// options as hooks.json passes them: arguments first, an unsubstituted placeholder means the default
r = hook('task-watch.mjs', ['--proactive', 'false'], { ...todos(9), session_id: 'sess-3' });
assert.equal(r.stdout, '', '--proactive false silences the hook');
r = hook('task-watch.mjs', ['--min_tasks', '2'], { ...todos(2), session_id: 'sess-4' });
assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /2 open tasks/, '--min_tasks sets the threshold');
r = hook('task-watch.mjs', ['--proactive', '${user_config.proactive}', '--min_tasks', '${user_config.min_tasks}'], { ...todos(3), session_id: 'sess-5' });
assert.equal(r.stdout, '', 'unsubstituted placeholders fall back to the default threshold');

r = hook('detect-agents.mjs', ['--hook'], { cwd: repo });
const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
assert.match(ctx, /codex/);
assert.match(ctx, /claude/);

// 4. validation errors are clear -----------------------------------------------
fs.writeFileSync(path.join(tmp, 'bad.json'), JSON.stringify({ workers: [{ id: 'x', provider: 'nope', brief: 'b' }] }));
r = run('spawn.mjs', ['--plan', path.join(tmp, 'bad.json')]);
assert.notEqual(r.status, 0);
assert.match(r.stderr, /unknown provider/);

console.log('smoke test passed');
fs.rmSync(tmp, { recursive: true, force: true });
