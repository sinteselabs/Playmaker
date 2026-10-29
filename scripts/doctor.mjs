#!/usr/bin/env node
// Checks what a parallel run needs, before the first one goes wrong halfway.
//   doctor.mjs                      node, git, the repository, the board, each agent CLI and its version
//   doctor.mjs --gates              also run the board's gates in a fresh worktree of the base branch
//   doctor.mjs --smoke [ids]        also send each installed CLI (or the listed ones, comma-separated) a
//                                   one-line prompt, which proves it is logged in. Spends a little quota.
//   doctor.mjs --json               the same, as JSON
// Exits 1 when a check fails, 0 otherwise. Warnings do not fail.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROVIDER_IDS, PROVIDERS } from './lib/providers.mjs';
import { readJson, repoRoot, runCommand, tryGit, which } from './lib/util.mjs';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const smokeAt = argv.indexOf('--smoke');
const smokeArg = smokeAt >= 0 && argv[smokeAt + 1] && !argv[smokeAt + 1].startsWith('--') ? argv[smokeAt + 1] : null;
const BOARD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'board.mjs');
const SMOKE_PROMPT = 'Reply with exactly the word PLAYMAKER-OK and nothing else. Do not read or change any file.';

const checks = [];
const add = (status, name, detail = '') => checks.push({ status, name, detail });
const firstLine = (s) => String(s || '').trim().split(/\r?\n/)[0];
const tail = (s, n = 600) => (s.length > n ? `...${s.slice(-n)}` : s);


// ---------------------------------------------------------------- basics

const nodeMajor = Number(process.versions.node.split('.')[0]);
add(nodeMajor >= 22 ? 'ok' : 'fail', 'node', `${process.versions.node}${nodeMajor >= 22 ? '' : ' (Playmaker needs 22 or newer)'}`);

const gitVersion = tryGit(process.cwd(), '--version');
add(gitVersion ? 'ok' : 'fail', 'git', gitVersion ? gitVersion.replace(/^git version /, '') : 'not found on PATH');

const root = repoRoot();
let board = null;
if (!root) {
  add('warn', 'repository', 'not inside a git repository: a parallel run needs one');
} else {
  board = readJson(path.join(root, '.playmaker', 'board.json'));
  const base = board?.base || 'main';
  const branch = tryGit(root, 'branch', '--show-current') || '(detached)';
  const dirty = tryGit(root, 'status', '--porcelain');
  add(branch === base ? 'ok' : 'warn', 'repository', `${root} on ${branch}${branch === base ? '' : ` (merges land on ${base}: switch to it before integrating)`}`);
  if (dirty) add('warn', 'working tree', 'uncommitted changes: workers branch from the committed base and will not see them');
  if (!board) {
    add('skip', 'board', 'no board yet (the plan command builds one)');
  } else {
    const v = spawnSync(process.execPath, [BOARD, 'validate'], { cwd: root, encoding: 'utf8' });
    const gates = board.gates || [];
    add(
      v.status === 0 ? 'ok' : 'fail',
      'board',
      v.status === 0 ? `valid: ${board.tasks.length} task(s), base ${base}, ${gates.length} gate(s)` : `invalid:\n${v.stderr.trim()}`
    );
    if (v.status === 0 && !gates.length) add('warn', 'gates', 'the board has no gates, so integration merges whatever the workers deliver');
    if (board.integration === 'pr') {
      // Pull request mode pushes each task's branch and opens a PR with the GitHub CLI.
      const origin = tryGit(root, 'remote', 'get-url', 'origin');
      add(origin ? 'ok' : 'fail', 'origin', origin || 'no remote named origin: pull request mode pushes there');
      if (!which('gh')) add('fail', 'gh', 'the GitHub CLI is not installed: pull request mode opens PRs with it');
      else {
        const auth = runCommand('gh', ['auth', 'status'], { cwd: root, timeout: 20000 });
        add(auth.status === 0 ? 'ok' : 'fail', 'gh', auth.status === 0 ? 'GitHub CLI logged in' : 'GitHub CLI not logged in: run gh auth login');
      }
    }
  }
}

// ---------------------------------------------------------------- agent CLIs

const installed = [];
for (const id of PROVIDER_IDS) {
  const p = PROVIDERS[id];
  const where = which(p.bin);
  if (!where) {
    add('skip', id, `${p.label}: not installed`);
    continue;
  }
  installed.push(id);
  const v = runCommand(p.bin, ['--version'], { timeout: 20000 });
  const version = firstLine(v.stdout) || firstLine(v.stderr);
  add(v.status === 0 ? 'ok' : 'warn', id, `${p.label} ${v.status === 0 ? version : `found but "--version" failed: ${version || v.error?.message || 'no output'}`}  (${where})`);
}
if (!installed.length) add('fail', 'agent CLIs', `none found. Install at least one of: ${PROVIDER_IDS.map((id) => PROVIDERS[id].bin).join(', ')}`);

// ---------------------------------------------------------------- gates and smoke, in a scratch checkout

const wantGates = argv.includes('--gates');
const smokeIds = smokeAt < 0 ? [] : smokeArg ? smokeArg.split(',').map((s) => s.trim()) : installed;
let scratch = null;

function scratchDir() {
  if (scratch) return scratch;
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'playmaker-doctor-'));
  const dir = path.join(scratch, 'checkout');
  if (root && tryGit(root, 'worktree', 'add', '--detach', dir, board?.base || 'HEAD') !== null) return dir;
  fs.mkdirSync(dir, { recursive: true });
  tryGit(dir, 'init', '-q');
  return dir;
}

function cleanup() {
  if (!scratch) return;
  const dir = path.join(scratch, 'checkout');
  if (root) {
    tryGit(root, 'worktree', 'remove', '--force', dir);
    tryGit(root, 'worktree', 'prune');
  }
  fs.rmSync(scratch, { recursive: true, force: true });
}

try {
  if (wantGates) {
    const gates = board?.gates || [];
    if (!gates.length) add('skip', 'gates', 'no board gates to run');
    for (const gate of gates) {
      const res = spawnSync(gate, { cwd: scratchDir(), shell: true, encoding: 'utf8', timeout: 10 * 60 * 1000, windowsHide: true });
      const out = `${res.stdout || ''}${res.stderr || ''}`.trim();
      add(res.status === 0 ? 'ok' : 'fail', 'gate', res.status === 0 ? gate : `${gate}\n${tail(out) || `exit ${res.status} ${res.signal || ''}`}`);
    }
  }
  for (const id of smokeIds) {
    const p = PROVIDERS[id];
    if (!p) {
      add('fail', `smoke ${id}`, `unknown provider. Known: ${PROVIDER_IDS.join(', ')}`);
      continue;
    }
    if (!installed.includes(id)) {
      add('skip', `smoke ${id}`, 'not installed');
      continue;
    }
    const cwd = scratchDir();
    const resultPath = path.join(scratch, `smoke-${id}.md`);
    const args = p.build({ prompt: SMOKE_PROMPT, model: '', allow: [], extra: [], resultPath });
    const res = runCommand(p.bin, args, { cwd, timeout: 3 * 60 * 1000 });
    let said = `${res.stdout || ''}${res.stderr || ''}`;
    if (fs.existsSync(resultPath)) said += fs.readFileSync(resultPath, 'utf8');
    const ok = res.status === 0 && said.includes('PLAYMAKER-OK');
    add(ok ? 'ok' : 'fail', `smoke ${id}`, ok ? `${p.label} answered` : `${p.label} did not answer as asked (exit ${res.status ?? res.signal ?? res.error?.message}). Is it logged in?\n${tail(said.trim())}`);
  }
} finally {
  cleanup();
}

// ---------------------------------------------------------------- output

const failed = checks.some((c) => c.status === 'fail');
if (asJson) {
  console.log(JSON.stringify({ ok: !failed, checks }, null, 2));
} else {
  const mark = { ok: 'ok  ', warn: 'warn', fail: 'FAIL', skip: '--  ' };
  console.log('Playmaker doctor');
  for (const c of checks) {
    const [head, ...more] = c.detail.split('\n');
    console.log(`  ${mark[c.status]}  ${c.name.padEnd(14)}${head}`);
    for (const line of more) console.log(`${' '.repeat(22)}${line}`);
  }
  const notRun = [!wantGates && board?.gates?.length ? '--gates (run the gates in a fresh worktree)' : null, smokeAt < 0 && installed.length ? '--smoke (prove each CLI is logged in)' : null].filter(Boolean);
  if (notRun.length) console.log(`\nNot checked: ${notRun.join(', ')}.`);
}
process.exitCode = failed ? 1 : 0;
