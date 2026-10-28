// End-to-end test of what a run gives project memory: search words per task, context in the brief,
// the run's page, the retrospective, the provider scorecard, and the session start note that a run
// is unfinished. No Lore needed: the scripts print what the manager writes there. Runs on
// Windows, macOS and Linux.
//   node tests/memory.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installFakes } from './lib/fakes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOARD = path.join(ROOT, 'scripts', 'board.mjs');
const DETECT = path.join(ROOT, 'scripts', 'detect-agents.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'playmaker-memory-'));
const repo = path.join(tmp, 'proj');
fs.mkdirSync(repo);
const env = installFakes(path.join(tmp, 'bin'), ['claude', 'codex'], { CLAUDE_PLUGIN_DATA: path.join(tmp, 'data') });

const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
const run = (...args) => spawnSync(process.execPath, [BOARD, ...args], { cwd: repo, env, encoding: 'utf8' });
const json = (r) => JSON.parse(r.stdout);
const task = (id) => json(run('show', '--json')).tasks.find((t) => t.id === id);
const hook = (...args) =>
  spawnSync(process.execPath, [DETECT, '--hook', ...args], { cwd: repo, env, input: JSON.stringify({ cwd: repo }), encoding: 'utf8' });

async function untilDelivered(id) {
  for (let i = 0; i < 120 && task(id).status === 'in_progress'; i += 1) {
    await sleep(500);
    run('sync');
  }
  assert.equal(task(id).status, 'delivered', `${id} should be delivered`);
}

g('init', '-q', '-b', 'main');
g('config', 'user.email', 'memory@example.com');
g('config', 'user.name', 'Memory');
fs.writeFileSync(path.join(repo, 'README.md'), '# proj\n');
g('add', '-A');
g('commit', '-q', '-m', 'init');

fs.mkdirSync(path.join(repo, '.playmaker'), { recursive: true });
fs.writeFileSync(
  path.join(repo, '.playmaker', 'board.json'),
  JSON.stringify(
    {
      base: 'main',
      lore: true,
      gates: [`node -e "process.exit(0)"`],
      tasks: [
        { id: 'users-api', title: 'Users endpoint with pagination', kind: 'backend', provider: 'claude', owns: ['src/api/users.ts'], brief: '# Task\nWRITE: src/api/users.ts' },
        { id: 'flaky', provider: 'codex', owns: ['src/flaky/'], brief: '# Task\nWRITE: src/flaky/f.txt' },
      ],
    },
    null,
    2
  )
);

// 1. recall: words to search project memory with, per task of the batch --------------------------
let r = run('recall');
assert.equal(r.status, 0, r.stderr);
const recall = json(r);
assert.deepEqual(recall.map((x) => x.task), ['users-api', 'flaky']);
assert.deepEqual(recall[0].terms.slice(0, 4), ['users', 'api', 'endpoint', 'with']);
assert.ok(recall[0].terms.includes('pagination'));
assert.ok(!recall[0].terms.includes('src'), 'generic folder names are left out');
assert.equal(recall[0].query, recall[0].terms.join(' OR '));
assert.notEqual(run('recall', 'nope').status, 0);

// 2. context: what the project knows goes into the next brief -----------------------------------
const notes = path.join(tmp, 'notes.md');
fs.writeFileSync(notes, '- decisions/pagination.md: cursors, never offsets.\n');
assert.notEqual(run('context', 'users-api').status, 0, 'context needs --file or --clear');
r = run('context', 'users-api', '--file', notes);
assert.equal(r.status, 0, r.stderr);
assert.match(task('users-api').context, /cursors, never offsets/);

r = run('start');
assert.equal(r.status, 0, r.stderr + r.stdout);
const brief = fs.readFileSync(path.join(task('users-api').worktree, '.playmaker', 'brief.md'), 'utf8');
assert.match(brief, /## What this project already knows[\s\S]*cursors, never offsets/);
assert.ok(brief.includes(`playmaker/${json(run('show', '--json')).run}/users-api.md`), 'with lore on, the worker is asked for its work page');
assert.doesNotMatch(fs.readFileSync(path.join(task('flaky').worktree, '.playmaker', 'brief.md'), 'utf8'), /already knows/, 'no context, no section');

// 3. the session start hook says the run is unfinished, even with proactive offers off ----------------
r = hook('--proactive', 'false');
assert.equal(r.status, 0, r.stderr);
assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /run b\S+ in this repository is unfinished \(2 running\)/);

// 4. one merges on the first round, the other is rejected twice and parked -----------------------------
await untilDelivered('users-api');
await untilDelivered('flaky');
r = run('integrate', 'users-api');
assert.equal(r.status, 0, r.stderr + r.stdout);
run('reject', 'flaky', '--note', 'wrong folder');
run('start');
await untilDelivered('flaky');
run('reject', 'flaky', '--note', 'still the wrong folder');
assert.equal(task('flaky').status, 'refix');

// 5. the run's page, the retrospective and the scorecard --------------------------------------------
r = run('page');
assert.equal(r.status, 0, r.stderr);
const page = json(r);
const runId = json(run('show', '--json')).run;
assert.equal(page.path, `playmaker/${runId}/board.md`);
assert.match(page.expires_at, /^\d{4}-\d{2}-\d{2}$/);
assert.ok(Date.parse(page.expires_at) > Date.now() + 5 * 86400000, 'expires about a week out');
assert.equal(page.tier, 'working');
assert.match(page.body, /\| users-api \| to_test \| Claude Code \| 1 \| [0-9a-f]{8} \|/);
assert.match(page.body, /\| flaky \| refix \| Codex CLI \| 2 \|/);

r = run('retro');
assert.match(r.stdout, /1 of 2 tasks merged, 1 on the first round\. 1 parked as ReFix\. 0 not finished\./);
assert.match(r.stdout, /\*\*flaky\*\* \(Codex CLI\): Rejected in review: wrong folder; then Rejected in review: still the wrong folder/);
const retro = json(run('retro', '--json'));
assert.equal(retro.summary.mergedFirstTry, 1);
assert.equal(retro.tasks.find((t) => t.id === 'users-api').failedRounds, 0);

r = run('scorecard', '--json');
const card = json(r);
assert.equal(card.entries, 2);
const row = (key) => card.rows.find((x) => x.key === key);
assert.equal(row('claude').merged, 1);
assert.equal(row('claude').firstTryRate, 100);
assert.equal(row('claude · backend').tasks, 1, 'counted by kind too');
assert.equal(row('codex').parked, 1);
assert.equal(row('codex').averageRounds, 2);
assert.match(run('scorecard').stdout, /\| Claude Code \| 1 \| 1 \| 100% \| 0 \| 1 \|/);
assert.ok(fs.existsSync(path.join(repo, '.playmaker', 'scorecard.json')), 'kept across runs, beside the board');

// 6. nothing left to do: the hook stays quiet about the run ------------------------------------------
r = hook('--proactive', 'false');
assert.equal(r.stdout, '', 'a run with nothing running, delivered or waiting is not announced');

// 7. a repository with no finished task yet says so ---------------------------------------------------
fs.rmSync(path.join(repo, '.playmaker', 'scorecard.json'));
assert.match(run('scorecard').stdout, /No finished task yet/);

console.log('memory test passed');
fs.rmSync(tmp, { recursive: true, force: true });
