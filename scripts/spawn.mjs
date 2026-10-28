#!/usr/bin/env node
// Low-level launcher: runs agent CLIs headless, each inside its own git worktree.
// Most of the time you want board.mjs, which sits on top of this. Use this directly for a one-shot batch.
//
//   node spawn.mjs --plan plan.json [--dry-run] [--no-commit]
//
// plan.json:
// {
//   "run": "optional-id",              // default: timestamp
//   "base": "HEAD",                    // commit the worktrees branch from
//   "timeoutMin": 30,                  // per worker
//   "workers": [
//     { "id": "api", "provider": "codex", "brief": "markdown text",   // or "briefFile": "path.md"
//       "model": "", "allow": [], "extraArgs": [] }
//   ]
// }
//
// Internal: node spawn.mjs --supervise <workerDir>   (runs one worker and records its outcome)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkFree, makeWorker, startWorker } from './lib/launch.mjs';
import { PROVIDERS } from './lib/providers.mjs';
import { git, isWin, killTree, quoteWin, readJson, repoRoot, tryGit, writeJsonAtomic } from './lib/util.mjs';

const MAX_WORKERS = 6;

function die(message) {
  process.stderr.write(`playmaker: ${message}\n`);
  process.exit(1);
}

export function stamp(prefix = 'r') {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${prefix}${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function commandLine(command, args) {
  return [command, ...args].map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

function spawnProvider(command, args, options) {
  if (isWin) {
    // npm-installed CLIs are .cmd shims on Windows and need a shell
    return spawn([command, ...args.map(quoteWin)].join(' '), [], { ...options, shell: true });
  }
  return spawn(command, args, options);
}

// ---------------------------------------------------------------- supervisor

function supervise(workerDir) {
  const worker = readJson(path.join(workerDir, 'worker.json'));
  if (!worker) die(`worker.json not found in ${workerDir}`);
  const statusFile = path.join(workerDir, 'status.json');
  const logFile = path.join(workerDir, 'log.txt');
  const resultFile = path.join(workerDir, 'result.md');
  const status = { state: 'running', supervisorPid: process.pid, startedAt: new Date().toISOString() };
  const save = () => writeJsonAtomic(statusFile, status);

  const out = fs.openSync(logFile, 'a');
  let child;
  try {
    child = spawnProvider(worker.command, worker.args, {
      cwd: worker.worktree,
      stdio: ['ignore', out, out],
      windowsHide: true,
      detached: !isWin,
    });
  } catch (e) {
    status.state = 'error';
    status.error = e.message;
    status.finishedAt = new Date().toISOString();
    save();
    return;
  }
  status.pid = child.pid;
  save();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child.pid);
  }, (worker.timeoutMin || 30) * 60 * 1000);

  const finalize = (state, code, error) => {
    clearTimeout(timer);
    status.state = state;
    status.exitCode = code;
    status.timedOut = timedOut;
    if (error) status.error = error;
    status.finishedAt = new Date().toISOString();

    try {
      if (!fs.existsSync(resultFile) || fs.statSync(resultFile).size === 0) {
        const log = fs.readFileSync(logFile, 'utf8');
        fs.writeFileSync(resultFile, log.length > 200000 ? log.slice(-200000) : log);
      }
    } catch {
      /* result is best effort */
    }

    if (worker.commit) {
      try {
        git(worker.worktree, 'add', '-A');
        const pending = git(worker.worktree, 'status', '--porcelain');
        if (pending) {
          git(worker.worktree, 'commit', '-m', `chore(${worker.id}): ${worker.provider} worker changes (playmaker ${worker.run})`);
        }
      } catch (e) {
        status.commitError = String(e.stderr || e.message).trim();
      }
    }
    status.head = tryGit(worker.worktree, 'rev-parse', 'HEAD');
    const changed = tryGit(worker.worktree, 'diff', '--name-only', `${worker.baseSha}..HEAD`);
    status.filesChanged = changed ? changed.split('\n').filter(Boolean).length : 0;
    save();
    process.exit(0);
  };

  child.on('error', (e) => finalize('error', null, e.message));
  child.on('close', (code) => finalize(timedOut ? 'timeout' : code === 0 ? 'done' : 'failed', code));
}

// ---------------------------------------------------------------- one-shot plan

function launch(planPath, { dryRun, commit }) {
  const root = repoRoot();
  if (!root) die('run this from inside a git repository.');
  const plan = readJson(path.resolve(planPath));
  if (!plan || !Array.isArray(plan.workers) || plan.workers.length === 0) die('plan needs a non-empty "workers" array.');
  if (plan.workers.length > MAX_WORKERS) die(`at most ${MAX_WORKERS} workers per run. Split the work in two runs.`);

  const run = plan.run || stamp();
  const seen = new Set();
  let workers;
  try {
    workers = plan.workers.map((raw) => {
      if (seen.has(raw.id)) throw new Error(`duplicate worker id "${raw.id}".`);
      seen.add(raw.id);
      let brief = raw.brief;
      if (!brief && raw.briefFile) brief = fs.readFileSync(path.resolve(raw.briefFile), 'utf8');
      return makeWorker(root, {
        run,
        id: raw.id,
        provider: raw.provider,
        brief,
        model: raw.model,
        allow: raw.allow,
        extraArgs: raw.extraArgs,
        timeoutMin: raw.timeoutMin || plan.timeoutMin,
        startPoint: plan.base || 'HEAD',
        commit,
      });
    });
  } catch (e) {
    die(e.message);
  }

  console.log(`Run ${run}  base ${plan.base || 'HEAD'} (${workers[0].baseSha.slice(0, 8)})  ${workers.length} worker(s)`);
  if (git(root, 'status', '--porcelain')) {
    console.log('WARNING: the working tree has uncommitted changes. Workers branch from the committed base and will not see them.');
  }
  for (const w of workers) {
    console.log(`- ${w.id}: ${PROVIDERS[w.provider].label}${w.installed ? '' : '  (NOT FOUND ON PATH)'}`);
    console.log(`    branch    ${w.branch}`);
    console.log(`    worktree  ${w.worktree}`);
    console.log(`    command   ${commandLine(w.command, w.args)}`);
  }

  if (dryRun) {
    console.log('\nDry run only. Nothing was created or started.');
    return;
  }
  const missing = workers.filter((w) => !w.installed);
  if (missing.length) die(`not installed: ${missing.map((w) => `${w.id} (${w.provider})`).join(', ')}.`);
  try {
    for (const w of workers) checkFree(root, w);
  } catch (e) {
    die(e.message);
  }
  for (const w of workers) startWorker(root, w);
  console.log(`\nStarted ${workers.length} worker(s). Check progress with:\n  node "${path.join(path.dirname(fileURLToPath(import.meta.url)), 'status.mjs')}" ${run}`);
}

// ---------------------------------------------------------------- entry

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes('--supervise')) {
    supervise(path.resolve(value('--supervise')));
  } else if (argv.includes('--plan')) {
    launch(value('--plan'), { dryRun: argv.includes('--dry-run'), commit: !argv.includes('--no-commit') });
  } else {
    console.log('usage: spawn.mjs --plan plan.json [--dry-run] [--no-commit]');
    process.exit(argv.length ? 1 : 0);
  }
}
