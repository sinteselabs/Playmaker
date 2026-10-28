#!/usr/bin/env node
// Detects which agent CLIs are installed and whether Playmaker runs are in flight.
//   --hook   SessionStart hook: reads stdin, prints hook JSON (only when there is something useful to say)
//   --print  prints the detection result as JSON
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROVIDERS } from './lib/providers.mjs';
import { dataDir, hookOutput, option, pidAlive, readJson, readStdinJson, repoRoot, which, writeJsonAtomic } from './lib/util.mjs';

function agentTeamsEnabled() {
  if (process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1') return true;
  const settings = readJson(path.join(os.homedir(), '.claude', 'settings.json'), {});
  return settings?.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1';
}

function runningWorkers(root) {
  if (!root) return 0;
  const runsDir = path.join(root, '.playmaker', 'runs');
  let count = 0;
  try {
    for (const run of fs.readdirSync(runsDir)) {
      for (const worker of fs.readdirSync(path.join(runsDir, run))) {
        const status = readJson(path.join(runsDir, run, worker, 'status.json'));
        if (status?.state === 'running' && pidAlive(status.supervisorPid)) count += 1;
      }
    }
  } catch {
    /* no runs yet */
  }
  return count;
}

/**
 * One line about a run this repository left unfinished, or null. It is how a new session picks up
 * where the last one stopped, with or without Lore: the board and the workers are on disk.
 */
export function unfinishedRun(root) {
  if (!root) return null;
  const b = readJson(path.join(root, '.playmaker', 'board.json'));
  if (!b?.run || !Array.isArray(b.tasks)) return null;
  const count = (...statuses) => b.tasks.filter((t) => statuses.includes(t.status || 'not_started')).length;
  const running = count('in_progress');
  const delivered = count('delivered');
  const waiting = count('not_started', 'rework');
  if (!running && !delivered && !waiting) return null;
  const parts = [running ? `${running} running` : '', delivered ? `${delivered} delivered and not integrated` : '', waiting ? `${waiting} waiting` : ''].filter(Boolean);
  return (
    `Playmaker: run ${b.run} in this repository is unfinished (${parts.join(', ')}). ` +
    'If the user wants to continue it, the sintese-playmaker:go skill resumes it from the board on disk; /sintese-playmaker:board shows it. Do not resume without being asked.'
  );
}

export function detect(cwd = process.cwd()) {
  const providers = {};
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const found = which(p.bin);
    if (found) providers[id] = { label: p.label, path: found };
  }
  const root = repoRoot(cwd);
  return {
    detectedAt: new Date().toISOString(),
    providers,
    agentTeams: agentTeamsEnabled(),
    gitRepo: Boolean(root),
    running: runningWorkers(root),
  };
}

const args = process.argv.slice(2);
if (args.includes('--hook')) {
  const input = await readStdinJson();
  const result = detect(input.cwd || process.cwd());
  try {
    writeJsonAtomic(path.join(dataDir(), 'providers.json'), result);
  } catch {
    /* cache is optional */
  }
  const ids = Object.keys(result.providers);
  const worthSaying = option('proactive', 'true') !== 'false' && (ids.length >= 2 || result.running > 0 || result.agentTeams);
  const parts = [];
  if (worthSaying) {
    parts.push(
      `Playmaker: agent CLIs on PATH: ${ids.join(', ') || 'none'}.`,
      `Agent teams: ${result.agentTeams ? 'enabled' : 'off'}.`,
      `Playmaker workers running in this repo: ${result.running}.`,
      'The sintese-playmaker:plan and sintese-playmaker:go skills cover parallel execution; /sintese-playmaker:board shows a run.'
    );
  }
  // Not a nudge: it reports work the user already started, so it is said even with proactive offers off.
  const resume = unfinishedRun(repoRoot(input.cwd || process.cwd()));
  if (resume) parts.push(resume);
  if (parts.length) process.stdout.write(hookOutput('SessionStart', parts.join(' ')));
} else if (args.includes('--print')) {
  process.stdout.write(JSON.stringify(detect(), null, 2) + '\n');
} else {
  process.stdout.write('usage: detect-agents.mjs --hook | --print\n');
}
