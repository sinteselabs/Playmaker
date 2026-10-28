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
  if (worthSaying) {
    const parts = [
      `Playmaker: agent CLIs on PATH: ${ids.join(', ') || 'none'}.`,
      `Agent teams: ${result.agentTeams ? 'enabled' : 'off'}.`,
      `Playmaker workers running in this repo: ${result.running}.`,
      'The sintese-playmaker:orchestrate and sintese-playmaker:run skills cover parallel execution.',
    ];
    process.stdout.write(hookOutput('SessionStart', parts.join(' ')));
  }
} else if (args.includes('--print')) {
  process.stdout.write(JSON.stringify(detect(), null, 2) + '\n');
} else {
  process.stdout.write('usage: detect-agents.mjs --hook | --print\n');
}
