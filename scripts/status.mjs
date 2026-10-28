#!/usr/bin/env node
// Shows the state of Playmaker workers.
//   node status.mjs [run]            table of workers (all runs, or one)
//   node status.mjs [run] --json     same, as JSON
//   node status.mjs <run> --overlap  files touched by more than one finished worker
import fs from 'node:fs';
import path from 'node:path';
import { pidAlive, readJson, repoRoot, tryGit } from './lib/util.mjs';

const argv = process.argv.slice(2);
const runFilter = argv.find((a) => !a.startsWith('--'));
const root = repoRoot();
if (!root) {
  console.error('playmaker: run this from inside the git repository.');
  process.exit(1);
}

function collect() {
  const runsDir = path.join(root, '.playmaker', 'runs');
  const rows = [];
  let runs = [];
  try {
    runs = fs.readdirSync(runsDir).filter((r) => !runFilter || r === runFilter);
  } catch {
    return rows;
  }
  for (const run of runs.sort()) {
    for (const id of fs.readdirSync(path.join(runsDir, run)).sort()) {
      const dir = path.join(runsDir, run, id);
      const worker = readJson(path.join(dir, 'worker.json'));
      if (!worker) continue;
      const status = readJson(path.join(dir, 'status.json'), { state: 'unknown' });
      let state = status.state;
      if (state === 'running' && !pidAlive(status.supervisorPid)) state = 'stale';
      const started = status.startedAt ? Date.parse(status.startedAt) : null;
      const ended = status.finishedAt ? Date.parse(status.finishedAt) : Date.now();
      rows.push({
        run,
        id,
        provider: worker.provider,
        state,
        minutes: started ? Math.round((ended - started) / 60000) : 0,
        filesChanged: status.filesChanged ?? null,
        branch: worker.branch,
        worktree: worker.worktree,
        baseSha: worker.baseSha,
        head: status.head || null,
        exitCode: status.exitCode ?? null,
        error: status.error || status.commitError || null,
        result: path.join(dir, 'result.md'),
        log: path.join(dir, 'log.txt'),
      });
    }
  }
  return rows;
}

const rows = collect();

if (argv.includes('--overlap')) {
  const byFile = new Map();
  for (const r of rows.filter((x) => x.state === 'done' && x.head)) {
    const files = tryGit(root, 'diff', '--name-only', `${r.baseSha}..${r.branch}`) || '';
    for (const f of files.split('\n').filter(Boolean)) {
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push(r.id);
    }
  }
  const overlaps = [...byFile.entries()].filter(([, ids]) => ids.length > 1);
  if (argv.includes('--json')) console.log(JSON.stringify(overlaps.map(([file, workers]) => ({ file, workers })), null, 2));
  else if (!overlaps.length) console.log('No file was changed by more than one worker.');
  else for (const [file, ids] of overlaps) console.log(`${file}  <-  ${ids.join(', ')}`);
} else if (argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else if (!rows.length) {
  console.log('No Playmaker runs in this repository.');
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad('RUN', 17)}${pad('WORKER', 14)}${pad('PROVIDER', 10)}${pad('STATE', 9)}${pad('MIN', 5)}${pad('FILES', 6)}BRANCH`);
  for (const r of rows) {
    console.log(`${pad(r.run, 17)}${pad(r.id, 14)}${pad(r.provider, 10)}${pad(r.state, 9)}${pad(r.minutes, 5)}${pad(r.filesChanged ?? '-', 6)}${r.branch}`);
    if (r.error) console.log(`    ${r.error.split('\n')[0]}`);
  }
}
