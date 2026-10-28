// End-to-end test of what the slash commands stand on: the monitor (board watch), sync, reject,
// stop, retry, report without a board, and the doctor. Runs on Windows, macOS and Linux.
//   node tests/commands.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installFakes } from './lib/fakes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOARD = path.join(ROOT, 'scripts', 'board.mjs');
const DOCTOR = path.join(ROOT, 'scripts', 'doctor.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'playmaker-commands-'));
const repo = path.join(tmp, 'proj');
fs.mkdirSync(repo);
const env = installFakes(path.join(tmp, 'bin'), ['claude', 'codex'], { CLAUDE_PLUGIN_DATA: path.join(tmp, 'data') });

const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
const run = (...args) => spawnSync(process.execPath, [BOARD, ...args], { cwd: repo, env, encoding: 'utf8' });
const json = (r) => JSON.parse(r.stdout);
const task = (id) => json(run('show', '--json')).tasks.find((t) => t.id === id);

g('init', '-q', '-b', 'main');
g('config', 'user.email', 'commands@example.com');
g('config', 'user.name', 'Commands');
fs.writeFileSync(path.join(repo, 'README.md'), '# proj\n');
g('add', '-A');
g('commit', '-q', '-m', 'init');

// 1. without a board, report explains instead of failing ------------------------------------
let r = run('report');
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout, /No Playmaker board/);
r = spawnSync(process.execPath, [BOARD, 'report'], { cwd: tmp, env, encoding: 'utf8' });
assert.equal(r.status, 0, 'outside a repository too');
r = spawnSync(process.execPath, [BOARD, 'watch'], { cwd: tmp, env, encoding: 'utf8', timeout: 10000 });
assert.equal(r.status, 0, 'the monitor exits quietly outside a repository');
assert.equal(r.stdout, '');

const board = {
  base: 'main',
  cap: 2,
  gates: [`node -e "process.exit(0)"`],
  tasks: [
    { id: 'a', provider: 'claude', owns: ['src/a/'], brief: '# Task a\nWRITE: src/a/a.txt' },
    { id: 's', provider: 'codex', owns: ['src/s/'], brief: '# Task s\nSLOW\nWRITE: src/s/s.txt' },
  ],
};
fs.mkdirSync(path.join(repo, '.playmaker'), { recursive: true });
fs.writeFileSync(path.join(repo, '.playmaker', 'board.json'), JSON.stringify(board, null, 2));

// 2. the monitor announces a delivery, once ------------------------------------------------
const lines = [];
const watch = spawn(process.execPath, [BOARD, 'watch'], { cwd: repo, env });
watch.stdout.on('data', (chunk) => lines.push(...chunk.toString().split('\n').filter(Boolean)));

r = run('start');
assert.equal(r.status, 0, r.stderr + r.stdout);
for (let i = 0; i < 120 && !lines.some((l) => /task a delivered/.test(l)); i += 1) await sleep(500);
assert.ok(lines.some((l) => /task a delivered by Claude Code/.test(l)), `monitor lines: ${JSON.stringify(lines)}`);
assert.equal(task('a').status, 'in_progress', 'the monitor never writes the board');

r = run('sync');
assert.equal(r.status, 0, r.stderr);
assert.deepEqual(json(r).delivered, ['a']);
assert.equal(task('a').status, 'delivered');

// 3. report shows what is running and with whom --------------------------------------------
r = run('report');
assert.match(r.stdout, /in_progress \(1\)\n {2}- s {2}\(Codex CLI, \d+ min\)/);
assert.match(r.stdout, /delivered \(1\)/);

// 4. reject sends a delivery back with the reason ------------------------------------------
r = run('reject', 'a');
assert.notEqual(r.status, 0, 'reject needs a note');
r = run('reject', 'a', '--note', 'the file needs a test');
assert.equal(r.status, 0, r.stderr);
assert.equal(task('a').status, 'rework');
assert.equal(task('a').attempts, 1);
assert.match(task('a').feedback, /Rejected in review: the file needs a test/);

// 5. stop kills the slow worker and leaves nothing behind -----------------------------------
const sWorktree = task('s').worktree;
r = run('stop', 's');
assert.equal(r.status, 0, r.stderr);
assert.deepEqual(json(r).stopped, ['s']);
const s = task('s');
assert.equal(s.status, 'not_started');
assert.equal(s.worktree, undefined);
assert.equal(fs.existsSync(sWorktree), false, 'stopped worktree removed');
assert.equal(g('branch', '--list', 'playmaker/*s*').includes('/s'), false, 'stopped branch removed');
r = run('stop', 'nope');
assert.notEqual(r.status, 0);

// 6. the rejected task comes back on its branch and merges -----------------------------------
r = run('set', 's', 'postponed', '--note', 'later');
assert.equal(r.status, 0);
r = run('start');
assert.equal(r.status, 0, r.stderr + r.stdout);
assert.equal(task('a').round, 2, 'second round for a');
assert.match(fs.readFileSync(path.join(task('a').worktree, '.playmaker', 'brief.md'), 'utf8'), /the file needs a test/, 'the reason reaches the next worker');
const announced = () => lines.filter((l) => /task a delivered/.test(l)).length;
for (let i = 0; i < 120 && announced() < 2; i += 1) await sleep(500);
assert.equal(announced(), 2, `one line per delivery, round 1 and round 2: ${JSON.stringify(lines)}`);
run('sync');
assert.equal(task('a').status, 'delivered');
r = run('integrate', 'a');
assert.equal(r.status, 0, r.stderr + r.stdout);
assert.equal(task('a').status, 'to_test');
for (let i = 0; i < 20 && !lines.some((l) => /no worker is running/.test(l)); i += 1) await sleep(500);
assert.ok(lines.some((l) => /no worker is running any more/.test(l)), `monitor lines: ${JSON.stringify(lines)}`);
assert.equal(announced(), 2, 'nothing announced twice');
watch.kill();

// 7. retry re-arms a parked task, with a note and a fresh count --------------------------------
r = run('retry', 'a');
assert.equal(r.status, 2, 'a merged task is not retried');
r = run('retry', 's', '--note', 'skip the slow part');
assert.equal(r.status, 0, r.stderr);
assert.equal(task('s').status, 'not_started', 'no branch left, so it starts fresh');
assert.equal(task('s').attempts, 0);
assert.match(task('s').feedback, /^Note from the user: skip the slow part/);

// 8. the doctor: CLIs, the board, the gates in a fresh worktree, and a smoke round trip ---------
r = spawnSync(process.execPath, [DOCTOR, '--gates', '--smoke', 'claude,codex', '--json'], { cwd: repo, env, encoding: 'utf8', timeout: 120000 });
const report = JSON.parse(r.stdout);
const check = (name) => report.checks.find((c) => c.name === name);
assert.equal(check('claude').status, 'ok');
assert.match(check('claude').detail, /9\.9\.9-fake/);
assert.equal(check('board').status, 'ok', check('board').detail);
assert.equal(check('gate').status, 'ok', check('gate').detail);
assert.equal(check('smoke claude').status, 'ok', check('smoke claude').detail);
assert.equal(check('smoke codex').status, 'ok', check('smoke codex').detail);
assert.equal(g('worktree', 'list').split('\n').length, 1, 'the doctor leaves no worktree behind');

fs.writeFileSync(path.join(repo, '.playmaker', 'board.json'), JSON.stringify({ ...board, gates: [`node -e "process.exit(4)"`] }, null, 2));
r = spawnSync(process.execPath, [DOCTOR, '--gates', '--json'], { cwd: repo, env, encoding: 'utf8', timeout: 120000 });
assert.equal(r.status, 1, 'a failing gate fails the doctor');
assert.equal(JSON.parse(r.stdout).checks.find((c) => c.name === 'gate').status, 'fail');

console.log('commands test passed');
fs.rmSync(tmp, { recursive: true, force: true });
