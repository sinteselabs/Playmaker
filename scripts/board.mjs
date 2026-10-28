#!/usr/bin/env node
// The manager's board: tasks, dependencies, collision-free batches, worker lifecycle and integration.
// It is the deterministic half of a parallel run: what can start, what collides, what merged.
// Judgement (is the diff good, what to tell the user) stays with the manager agent.
//
//   board.mjs validate
//   board.mjs show [--json]
//   board.mjs ready [--json]                 ready set and the batch that could start now
//   board.mjs start [--dry-run]              start the batch (one worktree + branch + worker per task)
//   board.mjs wait [--timeout-min N]         block until a worker delivers or fails (run it in the background)
//   board.mjs integrate <task> [--no-merge]  rebase on base, run gates, fast-forward merge, clean up
//   board.mjs set <task> <status> [--note T] [--confirmed-by-user]
//   board.mjs report [--json]
//
// Board file: <repo>/.playmaker/board.json, format in skills/orchestrate/references/board.md
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeWorker, removeWorktree, startWorker, checkFree, ID_RE } from './lib/launch.mjs';
import { PROVIDER_IDS, PROVIDERS } from './lib/providers.mjs';
import { git, pidAlive, readJson, repoRoot, tryGit, writeJsonAtomic } from './lib/util.mjs';
import { commandLine, stamp } from './spawn.mjs';

const STATUSES = ['not_started', 'in_progress', 'delivered', 'rework', 'to_test', 'refix', 'done', 'postponed'];
const MERGED = new Set(['to_test', 'done']);
const MAX_ATTEMPTS = 2;

const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = argv.slice(1);
const flag = (name) => rest.includes(name);
const flagValue = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const positional = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--note', '--timeout-min'].includes(rest[i - 1])));

function die(message, code = 1) {
  process.stderr.write(`playmaker: ${message}\n`);
  process.exit(code);
}

const root = repoRoot();
if (!root) die('run this from the main worktree of a git repository.');
const boardFile = path.join(root, '.playmaker', 'board.json');

// ---------------------------------------------------------------- model

function load() {
  const b = readJson(boardFile);
  if (!b) die(`no board at ${boardFile}. Write it first (format: skills/orchestrate/references/board.md).`);
  b.base = b.base || 'main';
  b.cap = b.cap || 4;
  b.gates = b.gates || [];
  b.sharedFiles = b.sharedFiles || [];
  b.timeoutMin = b.timeoutMin || 30;
  for (const t of b.tasks || []) {
    t.status = t.status || 'not_started';
    t.deps = t.deps || [];
    t.owns = t.owns || [];
    t.shared = t.shared || [];
    t.resources = t.resources || [];
    t.attempts = t.attempts || 0;
    t.round = t.round || 0;
    t.branches = t.branches || [];
    t.history = t.history || [];
  }
  return b;
}

const save = (b) => writeJsonAtomic(boardFile, b);
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
const pathsOverlap = (x, y) => x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);

function collides(a, b) {
  for (const x of a.owns) for (const y of b.owns) if (pathsOverlap(norm(x), norm(y))) return `both edit ${norm(x)}`;
  for (const s of a.shared) if (b.shared.includes(s)) return `both need shared file ${s}`;
  for (const r of a.resources) if (b.resources.includes(r)) return `both need resource ${r}`;
  return null;
}

function validate(b) {
  const problems = [];
  if (!Array.isArray(b.tasks) || b.tasks.length === 0) return ['board needs a non-empty "tasks" array.'];
  if (!tryGit(root, 'rev-parse', '--verify', b.base)) problems.push(`base "${b.base}" is not a branch or commit.`);
  if (!Number.isInteger(b.cap) || b.cap < 1 || b.cap > 8) problems.push('cap must be an integer from 1 to 8.');
  const ids = new Set();
  for (const t of b.tasks) {
    if (!ID_RE.test(t.id || '')) problems.push(`task id "${t.id}" is invalid. Use lowercase letters, digits and dashes.`);
    else if (/-r\d+$/.test(t.id)) problems.push(`task id "${t.id}" ends in -rN, which is reserved for retries.`);
    if (ids.has(t.id)) problems.push(`duplicate task id "${t.id}".`);
    ids.add(t.id);
    if (!PROVIDER_IDS.includes(t.provider)) problems.push(`task "${t.id}": unknown provider "${t.provider}". Known: ${PROVIDER_IDS.join(', ')}.`);
    if (!t.brief || !String(t.brief).trim()) problems.push(`task "${t.id}": empty brief.`);
    if (!STATUSES.includes(t.status)) problems.push(`task "${t.id}": unknown status "${t.status}".`);
    if (!t.owns.length) problems.push(`task "${t.id}": "owns" is empty. Name the files or folders it edits so collisions can be checked.`);
    for (const s of t.shared) if (!b.sharedFiles.includes(s)) problems.push(`task "${t.id}": shared file "${s}" is not in board.sharedFiles.`);
  }
  for (const t of b.tasks) {
    for (const d of t.deps) {
      if (!ids.has(d)) problems.push(`task "${t.id}": depends on unknown task "${d}".`);
      if (d === t.id) problems.push(`task "${t.id}": depends on itself.`);
    }
  }
  // cycles
  const byId = new Map(b.tasks.map((t) => [t.id, t]));
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      problems.push(`dependency cycle: ${[...trail, id].join(' -> ')}`);
      return;
    }
    state.set(id, 1);
    for (const d of byId.get(id)?.deps || []) if (byId.has(d)) visit(d, [...trail, id]);
    state.set(id, 2);
  };
  for (const t of b.tasks) visit(t.id, []);
  return problems;
}

function computeReady(b) {
  const byId = new Map(b.tasks.map((t) => [t.id, t]));
  const running = b.tasks.filter((t) => t.status === 'in_progress');
  const candidates = [];
  const blocked = [];
  for (const t of b.tasks) {
    if (!['not_started', 'rework'].includes(t.status)) continue;
    if (t.blockedOnUser) {
      blocked.push({ id: t.id, why: 'waiting for something only the user can do' });
      continue;
    }
    const unmet = t.deps.filter((d) => !MERGED.has(byId.get(d)?.status));
    if (unmet.length) {
      const parked = unmet.filter((d) => ['refix', 'postponed'].includes(byId.get(d)?.status));
      blocked.push({ id: t.id, why: parked.length ? `dependency parked: ${parked.join(', ')}` : `waiting for ${unmet.join(', ')} to be merged` });
      continue;
    }
    candidates.push(t);
  }
  const batch = [];
  const slots = b.cap - running.length;
  for (const c of candidates) {
    if (batch.length >= slots) {
      blocked.push({ id: c.id, why: 'no free slot (cap reached)' });
      continue;
    }
    let reason = null;
    for (const r of [...running, ...batch]) {
      reason = collides(r, c);
      if (reason) {
        reason = `${reason} with ${r.id}`;
        break;
      }
    }
    if (reason) blocked.push({ id: c.id, why: reason });
    else batch.push(c);
  }
  return { ready: candidates.map((t) => t.id), batch: batch.map((t) => t.id), running: running.map((t) => t.id), blocked };
}

function failTask(t, reason) {
  t.attempts += 1;
  t.feedback = reason;
  t.status = t.attempts >= MAX_ATTEMPTS ? 'refix' : 'rework';
  t.history.push({ at: new Date().toISOString(), event: 'failed', status: t.status, reason: reason.slice(0, 500) });
}

/** Fold worker outcomes into the board. Returns what changed. */
function sync(b) {
  const out = { changed: false, delivered: [], failed: [] };
  for (const t of b.tasks) {
    if (t.status !== 'in_progress' || !t.worker) continue;
    const dir = path.join(root, '.playmaker', 'runs', b.run, t.worker);
    const st = readJson(path.join(dir, 'status.json'));
    if (!st) continue;
    let state = st.state;
    if (state === 'running' && !pidAlive(st.supervisorPid)) state = 'stale';
    if (['queued', 'running'].includes(state)) continue;

    out.changed = true;
    if (state === 'done' && st.filesChanged > 0) {
      t.status = 'delivered';
      t.head = st.head;
      t.history.push({ at: new Date().toISOString(), event: 'delivered', worker: t.worker, head: st.head });
      out.delivered.push(t.id);
    } else {
      const why =
        state === 'done'
          ? 'the worker finished without committing any change'
          : `worker ${t.worker} ended as "${state}"${st.error ? `: ${st.error}` : ''}${st.commitError ? ` (commit error: ${st.commitError})` : ''}`;
      failTask(t, `${why}. See ${path.join(dir, 'log.txt')}`);
      out.failed.push({ id: t.id, reason: t.feedback, status: t.status });
    }
  }
  return out;
}

const tail = (s, n = 4000) => (s.length > n ? `...${s.slice(-n)}` : s);

// ---------------------------------------------------------------- commands

function cmdValidate() {
  const problems = validate(load());
  if (problems.length) {
    for (const p of problems) console.error(`- ${p}`);
    process.exit(1);
  }
  console.log('Board is valid.');
}

function cmdShow() {
  const b = load();
  if (flag('--json')) return console.log(JSON.stringify(b, null, 2));
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`base ${b.base}  cap ${b.cap}  gates ${b.gates.length}  run ${b.run || '-'}`);
  console.log(`${pad('TASK', 20)}${pad('STATUS', 13)}${pad('PROVIDER', 10)}${pad('ROUND', 6)}DEPS`);
  for (const t of b.tasks) console.log(`${pad(t.id, 20)}${pad(t.status, 13)}${pad(t.provider, 10)}${pad(t.round, 6)}${t.deps.join(',') || '-'}`);
}

function cmdReady() {
  const b = load();
  const problems = validate(b);
  if (problems.length) die(`board is invalid:\n- ${problems.join('\n- ')}`);
  const r = computeReady(b);
  if (flag('--json')) return console.log(JSON.stringify(r, null, 2));
  console.log(`running: ${r.running.join(', ') || '-'}`);
  console.log(`batch:   ${r.batch.join(', ') || '-'}`);
  for (const x of r.blocked) console.log(`held:    ${x.id}  (${x.why})`);
}

function cmdStart() {
  const b = load();
  const problems = validate(b);
  if (problems.length) die(`board is invalid:\n- ${problems.join('\n- ')}`);
  if (sync(b).changed) save(b);

  const { batch } = computeReady(b);
  if (!batch.length) {
    console.log('Nothing can start right now.');
    return;
  }
  const run = b.run || stamp('b');
  const byId = new Map(b.tasks.map((t) => [t.id, t]));
  const plans = batch.map((id) => {
    const t = byId.get(id);
    const round = t.round + 1;
    const workerId = round === 1 ? t.id : `${t.id}-r${round}`;
    const prevBranch = t.branch && tryGit(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${t.branch}`) ? t.branch : null;
    const retry = round > 1 && t.feedback;
    const brief =
      t.brief +
      (retry
        ? `\n\n## Previous attempt failed integration\n${t.feedback}\n\nYour branch already contains the commits of that attempt. Fix what is described above, keep the rest. If the failure was a rebase conflict, run "git rebase ${b.base}" in your worktree and resolve it.\n`
        : '');
    const w = makeWorker(root, {
      run,
      id: workerId,
      provider: t.provider,
      brief,
      model: t.model,
      allow: t.allow,
      extraArgs: t.extraArgs,
      timeoutMin: t.timeoutMin || b.timeoutMin,
      startPoint: round > 1 && prevBranch ? prevBranch : b.base,
    });
    return { t, w, round };
  });

  for (const { t, w } of plans) {
    console.log(`- ${t.id}${w.id !== t.id ? ` (round ${w.id.split('-r').pop()})` : ''}: ${PROVIDERS[t.provider].label}${w.installed ? '' : '  (NOT FOUND ON PATH)'}`);
    console.log(`    branch    ${w.branch}`);
    console.log(`    worktree  ${w.worktree}`);
    console.log(`    command   ${commandLine(w.command, w.args)}`);
  }
  if (flag('--dry-run')) return console.log('\nDry run only. Nothing was started.');
  const missing = plans.filter((p) => !p.w.installed);
  if (missing.length) die(`not installed: ${missing.map((p) => `${p.t.id} (${p.t.provider})`).join(', ')}.`);

  for (const { t, w, round } of plans) {
    if (round > 1 && t.worktree) removeWorktree(root, t.worktree);
    checkFree(root, w);
  }
  b.run = run;
  for (const { t, w, round } of plans) {
    startWorker(root, w, { gates: b.gates });
    t.status = 'in_progress';
    t.worker = w.id;
    t.round = round;
    t.branch = w.branch;
    t.worktree = w.worktree;
    t.branches.push(w.branch);
    t.history.push({ at: new Date().toISOString(), event: 'started', worker: w.id, provider: t.provider });
    save(b);
  }
  console.log(`\nStarted ${plans.length} worker(s). Wait for deliveries with:\n  node "${process.argv[1]}" wait`);
}

async function cmdWait() {
  const timeoutMin = Number(flagValue('--timeout-min')) || 120;
  const deadline = Date.now() + timeoutMin * 60000;
  const newlyFailed = [];
  for (;;) {
    const b = load();
    const ch = sync(b);
    if (ch.changed) save(b);
    newlyFailed.push(...ch.failed);
    const running = b.tasks.filter((t) => t.status === 'in_progress').map((t) => t.id);
    const delivered = b.tasks.filter((t) => t.status === 'delivered').map((t) => t.id);
    const timedOut = Date.now() > deadline;
    if (delivered.length || newlyFailed.length || running.length === 0 || timedOut) {
      console.log(JSON.stringify({ delivered, failed: newlyFailed, running, timedOut: timedOut || undefined }, null, 2));
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

function runGate(gate, cwd) {
  const res = spawnSync(gate, { cwd, shell: true, encoding: 'utf8', timeout: 10 * 60 * 1000, windowsHide: true });
  return { ok: res.status === 0, output: `${res.stdout || ''}${res.stderr || ''}`.trim(), status: res.status, signal: res.signal };
}

function cmdIntegrate() {
  const id = positional[0];
  if (!id) die('usage: integrate <task> [--no-merge]');
  const b = load();
  const t = b.tasks.find((x) => x.id === id);
  if (!t) die(`no task "${id}".`);
  if (t.status !== 'delivered') die(`task "${id}" is "${t.status}", not "delivered".`, 2);

  const current = tryGit(root, 'branch', '--show-current');
  if (current !== b.base) die(`the main worktree is on "${current}", not on base "${b.base}". Switch it first.`, 2);
  if (git(root, 'status', '--porcelain')) die('the main worktree has uncommitted changes. Commit or stash them first.', 2);

  const fail = (stage, detail) => {
    failTask(t, `${stage}\n${tail(detail)}`);
    save(b);
    console.log(JSON.stringify({ task: id, ok: false, stage, status: t.status, attempts: t.attempts, detail: tail(detail, 2000) }, null, 2));
    process.exit(3);
  };

  // 1. rebase the worker's branch on the current base
  const rebase = spawnSync('git', ['rebase', b.base], { cwd: t.worktree, encoding: 'utf8' });
  if (rebase.status !== 0) {
    spawnSync('git', ['rebase', '--abort'], { cwd: t.worktree });
    fail(`rebase onto ${b.base} failed`, `${rebase.stdout || ''}${rebase.stderr || ''}`);
  }

  // 2. gates, run by the manager, never taken from the worker's word
  const gateResults = [];
  for (const gate of b.gates) {
    const r = runGate(gate, t.worktree);
    gateResults.push({ gate, ok: r.ok });
    if (!r.ok) fail(`gate failed: ${gate}`, r.output || `exit ${r.status} ${r.signal || ''}`);
  }

  if (flag('--no-merge')) {
    console.log(JSON.stringify({ task: id, ok: true, merged: false, gates: gateResults }, null, 2));
    return;
  }

  // 3. fast-forward merge, never force
  const merge = spawnSync('git', ['merge', '--ff-only', t.branch], { cwd: root, encoding: 'utf8' });
  if (merge.status !== 0) fail('fast-forward merge failed', `${merge.stdout || ''}${merge.stderr || ''}`);

  t.status = 'to_test';
  t.merged = git(root, 'rev-parse', 'HEAD');
  t.history.push({ at: new Date().toISOString(), event: 'merged', commit: t.merged });
  removeWorktree(root, t.worktree);
  for (const br of t.branches) tryGit(root, 'branch', '-D', br);
  save(b);
  console.log(JSON.stringify({ task: id, ok: true, merged: true, commit: t.merged, status: t.status, gates: gateResults }, null, 2));
}

function cmdSet() {
  const [id, status] = positional;
  if (!id || !status) die('usage: set <task> <status> [--note text] [--confirmed-by-user]');
  if (!STATUSES.includes(status)) die(`unknown status "${status}". Known: ${STATUSES.join(', ')}.`);
  const b = load();
  const t = b.tasks.find((x) => x.id === id);
  if (!t) die(`no task "${id}".`);
  if (status === 'done' && !flag('--confirmed-by-user')) {
    die('only the user promotes a task to "done". Pass --confirmed-by-user once they have said so.', 2);
  }
  t.status = status;
  if (status === 'refix' || status === 'postponed') t.note = flagValue('--note') || t.note;
  t.history.push({ at: new Date().toISOString(), event: `set:${status}`, note: flagValue('--note') });
  save(b);
  console.log(`${id} -> ${status}`);
}

function cmdReport() {
  const b = load();
  const groups = {};
  for (const t of b.tasks) (groups[t.status] ||= []).push(t);
  if (flag('--json')) {
    return console.log(JSON.stringify(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.map((t) => ({ id: t.id, commit: t.merged, attempts: t.attempts, note: t.note, feedback: t.feedback }))])), null, 2));
  }
  const order = ['to_test', 'done', 'delivered', 'in_progress', 'rework', 'refix', 'postponed', 'not_started'];
  for (const s of order) {
    if (!groups[s]) continue;
    console.log(`${s} (${groups[s].length})`);
    for (const t of groups[s]) {
      const extra = [t.merged ? `commit ${t.merged.slice(0, 8)}` : null, t.attempts ? `${t.attempts} failed attempt(s)` : null, t.note, s === 'refix' || s === 'rework' ? t.feedback?.split('\n')[0] : null]
        .filter(Boolean)
        .join('; ');
      console.log(`  - ${t.id}${extra ? `  (${extra})` : ''}`);
    }
  }
  const r = computeReady(b);
  if (r.blocked.length) {
    console.log('held');
    for (const x of r.blocked) console.log(`  - ${x.id}  (${x.why})`);
  }
}

const commands = { validate: cmdValidate, show: cmdShow, ready: cmdReady, start: cmdStart, wait: cmdWait, integrate: cmdIntegrate, set: cmdSet, report: cmdReport };
if (!commands[cmd]) {
  console.log('usage: board.mjs validate | show | ready | start | wait | integrate <task> | set <task> <status> | report');
  process.exit(cmd ? 1 : 0);
}
await commands[cmd]();
