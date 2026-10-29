// End-to-end test of pull request mode ("integration": "pr") with a local bare repository as
// origin and a fake GitHub CLI: a delivery becomes a PR, changes requested send it back, the next
// round supersedes the old PR, a merge on the remote unblocks what depends on it, and a task whose
// PR is open still holds its files. Nothing reaches GitHub. Runs on Windows, macOS and Linux.
//   node tests/prmode.mjs
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'playmaker-prmode-'));
const repo = path.join(tmp, 'proj');
const origin = path.join(tmp, 'origin.git');
const ghState = path.join(tmp, 'gh.json');
fs.mkdirSync(repo);
const env = installFakes(path.join(tmp, 'bin'), ['claude', 'codex', 'gh'], { CLAUDE_PLUGIN_DATA: path.join(tmp, 'data'), FAKE_GH_STATE: ghState });

const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
const run = (...args) => spawnSync(process.execPath, [BOARD, ...args], { cwd: repo, env, encoding: 'utf8' });
const json = (r) => JSON.parse(r.stdout);
const task = (id) => json(run('show', '--json')).tasks.find((t) => t.id === id);
const prs = () => JSON.parse(fs.readFileSync(ghState, 'utf8'));
const editPr = (n, change) => fs.writeFileSync(ghState, JSON.stringify({ ...prs(), [n]: { ...prs()[n], ...change } }, null, 2));

async function untilDelivered(id) {
  for (let i = 0; i < 120 && task(id).status === 'in_progress'; i += 1) {
    await sleep(500);
    run('sync');
  }
  assert.equal(task(id).status, 'delivered', `${id} should be delivered`);
}

execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
g('init', '-q', '-b', 'main');
g('config', 'user.email', 'pr@example.com');
g('config', 'user.name', 'PR');
fs.writeFileSync(path.join(repo, 'README.md'), '# proj\n');
g('add', '-A');
g('commit', '-q', '-m', 'init');
g('remote', 'add', 'origin', origin);
g('push', '-q', '-u', 'origin', 'main');

fs.mkdirSync(path.join(repo, '.playmaker'), { recursive: true });
const board = {
  base: 'main',
  integration: 'pr',
  gates: [`node -e "process.exit(0)"`],
  tasks: [
    { id: 'a', title: 'Users table', provider: 'claude', owns: ['src/a/'], brief: '# Task a\nWRITE: src/a/a.txt\nHOWTO: open src/a/a.txt' },
    { id: 'b', provider: 'codex', owns: ['src/b/'], deps: ['a'], brief: '# Task b\nWRITE: src/b/b.txt' },
    { id: 'c', provider: 'claude', owns: ['src/a/sub/'], brief: '# Task c\nWRITE: src/a/sub/c.txt' },
  ],
};
fs.writeFileSync(path.join(repo, '.playmaker', 'board.json'), JSON.stringify(board, null, 2));

// 0. the board and the doctor know the mode ----------------------------------------------------------
assert.equal(run('validate').status, 0);
fs.writeFileSync(path.join(repo, '.playmaker', 'board.json'), JSON.stringify({ ...board, integration: 'push' }, null, 2));
assert.match(run('validate').stderr, /integration must be "merge" or "pr"/);
fs.writeFileSync(path.join(repo, '.playmaker', 'board.json'), JSON.stringify(board, null, 2));
const doctor = JSON.parse(spawnSync(process.execPath, [DOCTOR, '--json'], { cwd: repo, env, encoding: 'utf8' }).stdout);
assert.equal(doctor.checks.find((c) => c.name === 'origin').status, 'ok');
assert.equal(doctor.checks.find((c) => c.name === 'gh').status, 'ok');

// 1. a delivery becomes a pull request ---------------------------------------------------------------
let r = run('start');
assert.equal(r.status, 0, r.stderr + r.stdout);
assert.deepEqual(json(run('show', '--json')).tasks.filter((t) => t.status === 'in_progress').map((t) => t.id), ['a'], 'c collides with a, b waits for it');
await untilDelivered('a');
fs.writeFileSync(path.join(repo, 'scratch.txt'), 'the main worktree may be dirty: nothing merges there in this mode\n');
r = run('integrate', 'a');
assert.equal(r.status, 0, r.stderr + r.stdout);
assert.equal(json(r).pr, 'https://github.com/fake/repo/pull/1');
const a = task('a');
assert.equal(a.status, 'in_review');
assert.equal(a.pr.url, 'https://github.com/fake/repo/pull/1');
assert.equal(fs.existsSync(a.worktree), false, 'the worktree goes, the branch stays for another round');
assert.ok(g('ls-remote', '--heads', 'origin').includes(a.branch), 'the branch is on origin');
const pr1 = prs()['1'];
assert.equal(pr1.base, 'main');
assert.equal(pr1.head, a.branch);
assert.equal(pr1.title, 'Users table');
assert.match(pr1.body, /## How to test\n\nopen src\/a\/a\.txt/);
assert.match(pr1.body, /gates: `node -e/);
fs.rmSync(path.join(repo, 'scratch.txt'));

// 2. an open pull request holds its files and blocks what depends on it --------------------------------
const held = Object.fromEntries(json(run('ready', '--json')).blocked.map((x) => [x.id, x.why]));
assert.match(held.b, /waiting for a to be merged/);
assert.match(held.c, /both edit src\/a(\/sub)? with a/);
assert.match(run('report').stdout, /in_review \(1\)\n {2}- a {2}\(https:\/\/github\.com\/fake\/repo\/pull\/1\)/);

// 3. changes requested send it back; the next round supersedes the old PR -------------------------------
editPr('1', { reviewDecision: 'CHANGES_REQUESTED', reviews: [{ state: 'CHANGES_REQUESTED', body: 'name the file users.txt' }] });
r = run('sync');
assert.deepEqual(json(r).failed.map((x) => x.id), ['a']);
assert.equal(task('a').status, 'rework');
assert.match(task('a').feedback, /changes were requested on the pull request: name the file users\.txt/);
run('start');
assert.match(fs.readFileSync(path.join(task('a').worktree, '.playmaker', 'brief.md'), 'utf8'), /name the file users\.txt/);
await untilDelivered('a');
r = run('integrate', 'a');
assert.equal(r.status, 0, r.stderr + r.stdout);
assert.equal(json(r).pr, 'https://github.com/fake/repo/pull/2');
assert.equal(prs()['1'].state, 'CLOSED');
assert.match(prs()['1'].closeComment, /Superseded by round 2: https:\/\/github\.com\/fake\/repo\/pull\/2/);

// 4. the monitor says when a pull request is merged ---------------------------------------------------
const head = g('rev-parse', task('a').branch);
g('push', '-q', 'origin', `${task('a').branch}:main`);
editPr('2', { state: 'MERGED', mergeCommit: head });
const lines = [];
const watch = spawn(process.execPath, [BOARD, 'watch'], { cwd: repo, env });
watch.stdout.on('data', (d) => lines.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 40 && !lines.some((l) => /was merged/.test(l)); i += 1) await sleep(250);
watch.kill();
assert.ok(lines.some((l) => l.includes('the pull request for task a was merged (https://github.com/fake/repo/pull/2)')), JSON.stringify(lines));
assert.equal(task('a').status, 'in_review', 'the monitor only reads');

// 5. sync folds the merge in: To test, scorecard, local branches gone ------------------------------------
r = run('sync');
assert.deepEqual(json(r).merged, ['a']);
const merged = task('a');
assert.equal(merged.status, 'to_test');
assert.equal(merged.merged, head);
assert.equal(merged.howToTest, 'open src/a/a.txt');
assert.equal(g('branch', '--list', 'playmaker/*'), '', 'no local branch left');
assert.equal(json(run('scorecard', '--json')).rows.find((x) => x.key === 'claude').merged, 1);

// 6. what depended on it starts from origin/main, which has the merged work ---------------------------------
r = run('start');
assert.equal(r.status, 0, r.stderr + r.stdout);
assert.ok(fs.existsSync(path.join(task('b').worktree, 'src', 'a', 'a.txt')), 'b starts from origin/main with a merged');
assert.equal(task('c').status, 'in_progress', 'and c no longer collides');

// 7. red checks and a closed PR send work back too ---------------------------------------------------------
await untilDelivered('c');
run('integrate', 'c');
const cNumber = task('c').pr.url.split('/').pop();
editPr(cNumber, { statusCheckRollup: [{ name: 'checks / cli', conclusion: 'SUCCESS' }, { name: 'checks / e2e', conclusion: 'FAILURE' }] });
run('sync');
assert.match(task('c').feedback, /checks failed on the pull request: checks \/ e2e/);
await untilDelivered('b');
run('integrate', 'b');
editPr(task('b').pr.url.split('/').pop(), { state: 'CLOSED' });
run('sync');
assert.match(task('b').feedback, /the pull request was closed without merging/);

// 8. when no PR can be opened, integrate refuses and counts nothing ------------------------------------
// Without the fake, a real gh may be on PATH (GitHub's runners have one): it cannot open a PR for a
// local origin either, so both ways end the same, and nothing reaches GitHub.
fs.rmSync(path.join(tmp, 'bin', process.platform === 'win32' ? 'gh.cmd' : 'gh'));
run('start');
await untilDelivered('b');
const attempts = task('b').attempts;
r = run('integrate', 'b');
assert.equal(r.status, 4);
assert.match(r.stderr, /the GitHub CLI \(gh\) is not installed|could not open the pull request/);
assert.equal(task('b').status, 'delivered');
assert.equal(task('b').attempts, attempts);
run('stop');

console.log('pr mode test passed');
fs.rmSync(tmp, { recursive: true, force: true });
