// End-to-end test of the manager loop (board.mjs) with fake agent CLIs. Runs on macOS and Linux.
//   node tests/board.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOARD = path.join(ROOT, 'scripts', 'board.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'playmaker-board-'));
const repo = path.join(tmp, 'proj');
const bin = path.join(tmp, 'bin');
fs.mkdirSync(repo);
fs.mkdirSync(bin);

// One fake agent used under two provider names. It reads the brief and does what the brief says.
const fakeAgent = `#!/bin/sh
brief=.playmaker/brief.md
test -f $brief || { echo "no brief" >&2; exit 3; }
f=$(grep -m1 '^WRITE:' $brief | sed 's/^WRITE: //')
mkdir -p "$(dirname "$f")"
echo "$f by $(basename "$0")" > "$f"
if grep -q 'Previous attempt failed' $brief; then rm -f BAD; fi
if grep -q '^BREAK-FIRST' $brief && ! grep -q 'Previous attempt failed' $brief; then echo bad > BAD; fi
git add -A >/dev/null 2>&1
git commit -q -m "feat: $f" >/dev/null 2>&1
echo "report for $f"
`;
for (const name of ['claude', 'codex']) {
  const file = path.join(bin, name);
  fs.writeFileSync(file, fakeAgent);
  fs.chmodSync(file, 0o755);
}
const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CLAUDE_PLUGIN_DATA: path.join(tmp, 'data') };

const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
g('init', '-q', '-b', 'main');
g('config', 'user.email', 'board@example.com');
g('config', 'user.name', 'Board');
fs.writeFileSync(path.join(repo, 'package.json'), '{}\n');
g('add', '-A');
g('commit', '-q', '-m', 'init');

const task = (id, extra) => ({ id, provider: 'claude', brief: `# Task ${id}\nWRITE: ${extra.owns[0].replace(/\/$/, '')}/${id}.txt`, ...extra });
const board = {
  base: 'main',
  cap: 3,
  gates: [`node -e "process.exit(require('fs').existsSync('BAD')?1:0)"`],
  sharedFiles: ['package.json'],
  tasks: [
    task('a', { owns: ['src/a/'] }),
    task('b', { owns: ['src/b/'], deps: ['a'], provider: 'codex' }),
    task('c', { owns: ['src/a/sub/'] }),
    task('d', { owns: ['src/d/'], provider: 'codex', brief: '# Task d\nWRITE: src/d/d.txt\nBREAK-FIRST' }),
    task('e', { owns: ['pkg/'], shared: ['package.json'] }),
    task('f', { owns: ['docs/'], shared: ['package.json'] }),
  ],
};
fs.mkdirSync(path.join(repo, '.playmaker'), { recursive: true });
fs.writeFileSync(path.join(repo, '.playmaker', 'board.json'), JSON.stringify(board, null, 2));

const run = (...args) => spawnSync(process.execPath, [BOARD, ...args], { cwd: repo, env, encoding: 'utf8' });
const json = (r) => JSON.parse(r.stdout);
const status = (id) => json(run('show', '--json')).tasks.find((t) => t.id === id).status;

async function drain() {
  for (let i = 0; i < 200; i += 1) {
    const out = json(run('wait', '--timeout-min', '1'));
    if (out.running.length === 0 || out.delivered.length) {
      if (out.running.length === 0) return out;
      // others still running: give them a moment, then ask again
      await sleep(250);
      const again = json(run('wait', '--timeout-min', '1'));
      if (again.running.length === 0) return again;
    }
  }
  throw new Error('workers did not finish');
}

// 1. validation ---------------------------------------------------------------
let r = run('validate');
assert.equal(r.status, 0, r.stderr);

const bad = structuredClone(board);
bad.tasks[1].deps = ['b'];
bad.tasks[0].deps = ['b'];
fs.writeFileSync(path.join(repo, '.playmaker', 'board-bad.json'), JSON.stringify(bad));
fs.copyFileSync(path.join(repo, '.playmaker', 'board.json'), path.join(repo, '.playmaker', 'board-good.json'));
fs.copyFileSync(path.join(repo, '.playmaker', 'board-bad.json'), path.join(repo, '.playmaker', 'board.json'));
r = run('validate');
assert.notEqual(r.status, 0);
assert.match(r.stderr, /dependency cycle/);
fs.copyFileSync(path.join(repo, '.playmaker', 'board-good.json'), path.join(repo, '.playmaker', 'board.json'));

// 2. first batch respects deps, collisions, shared files and the cap -----------------
r = run('ready', '--json');
assert.deepEqual(json(r).batch, ['a', 'd', 'e'], 'b waits for a, c collides with a, f has no slot');
const why = Object.fromEntries(json(r).blocked.map((x) => [x.id, x.why]));
assert.match(why.b, /waiting for a/);
assert.match(why.c, /both edit/);
assert.match(why.f, /no free slot|shared file/);

r = run('start');
assert.equal(r.status, 0, r.stderr + r.stdout);
await drain();
for (const id of ['a', 'd', 'e']) assert.equal(status(id), 'delivered', `${id} should be delivered`);

// 3. integrate: green merges, red goes back for rework ---------------------------------
r = run('integrate', 'a');
assert.equal(r.status, 0, r.stderr + r.stdout);
assert.equal(json(r).merged, true);
r = run('integrate', 'd');
assert.equal(r.status, 3, 'gate failure exits 3');
assert.equal(json(r).ok, false);
assert.equal(status('d'), 'rework');
r = run('integrate', 'e');
assert.equal(r.status, 0, r.stderr + r.stdout);
assert.equal(status('a'), 'to_test');
assert.equal(status('e'), 'to_test');
assert.ok(fs.existsSync(path.join(repo, 'src', 'a', 'a.txt')), 'a is on main');
assert.equal(g('worktree', 'list').split('\n').length, 2, 'only main and the d worktree remain');

// 4. second round: a is merged so b unblocks, c no longer collides, d is retried -------
r = run('ready', '--json');
assert.deepEqual(json(r).batch, ['b', 'c', 'd']);
r = run('start');
assert.equal(r.status, 0, r.stderr + r.stdout);
await drain();
for (const id of ['b', 'c', 'd']) assert.equal(status(id), 'delivered', `${id} should be delivered`);
for (const id of ['b', 'c', 'd']) {
  r = run('integrate', id);
  assert.equal(r.status, 0, `${id}: ${r.stderr}${r.stdout}`);
}
const d = json(run('show', '--json')).tasks.find((t) => t.id === 'd');
assert.equal(d.round, 2);
assert.equal(d.attempts, 1);
assert.equal(d.status, 'to_test');

// 5. last task, then the final state ----------------------------------------------------
assert.deepEqual(json(run('ready', '--json')).batch, ['f']);
run('start');
await drain();
r = run('integrate', 'f');
assert.equal(r.status, 0, r.stderr + r.stdout);

for (const t of json(run('show', '--json')).tasks) assert.equal(t.status, 'to_test', t.id);
for (const file of ['src/a/a.txt', 'src/b/b.txt', 'src/a/sub/c.txt', 'src/d/d.txt', 'pkg/e.txt', 'docs/f.txt']) {
  assert.ok(fs.existsSync(path.join(repo, file)), `${file} merged into main`);
}
assert.equal(fs.existsSync(path.join(repo, 'BAD')), false, 'the failing change never reached main');
assert.equal(g('worktree', 'list').split('\n').length, 1, 'no orphan worktrees');
assert.equal(g('branch', '--list').replace(/[* ]/g, ''), 'main', 'no orphan branches');
assert.equal(g('status', '--porcelain'), '', 'main stays clean');
assert.ok(g('log', '--oneline').split('\n').length >= 7);

// 6. only the user promotes to done -----------------------------------------------------
r = run('set', 'a', 'done');
assert.equal(r.status, 2);
assert.match(r.stderr, /only the user/);
r = run('set', 'a', 'done', '--confirmed-by-user');
assert.equal(r.status, 0);
assert.equal(status('a'), 'done');

// 7. report mentions what is waiting for the user ------------------------------------------
r = run('report');
assert.match(r.stdout, /to_test \(5\)/);
assert.match(r.stdout, /done \(1\)/);

console.log('board test passed');
fs.rmSync(tmp, { recursive: true, force: true });
