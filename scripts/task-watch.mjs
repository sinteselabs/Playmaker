#!/usr/bin/env node
// PostToolUse hook for TaskCreate, TaskUpdate and TodoWrite.
// Counts open tasks per session and, once the count crosses the threshold, adds one short factual
// note to the context so Claude can decide whether to offer parallel execution. Never blocks anything.
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, hookOutput, option, readJson, readStdinJson, writeJsonAtomic } from './lib/util.mjs';

const input = await readStdinJson();

try {
  if (option('proactive', 'true') === 'false') process.exit(0);

  const threshold = Math.max(2, Number(option('min_tasks', 4)) || 4);
  const sessionId = String(input.session_id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
  const stateFile = path.join(dataDir(), 'sessions', `${sessionId}.json`);
  const state = readJson(stateFile, { open: 0, offered: false });

  const tool = input.tool_name;
  const toolInput = input.tool_input || {};

  if (tool === 'TodoWrite' && Array.isArray(toolInput.todos)) {
    state.open = toolInput.todos.filter((t) => t && t.status !== 'completed').length;
  } else if (tool === 'TaskCreate') {
    state.open += 1;
  } else if (tool === 'TaskUpdate' && ['completed', 'deleted'].includes(toolInput.status)) {
    state.open = Math.max(0, state.open - 1);
  }

  let output = '';
  if (!state.offered && state.open >= threshold) {
    state.offered = true;
    output = hookOutput(
      'PostToolUse',
      `Playmaker note: ${state.open} open tasks are tracked in this session. ` +
        'The sintese-playmaker:plan skill covers when running them in parallel fits and how to offer that to the user, once, with approval before anything launches.'
    );
  }

  writeJsonAtomic(stateFile, state);
  // keep the state directory from growing forever
  try {
    const dir = path.dirname(stateFile);
    const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch {
    /* best effort */
  }

  if (output) process.stdout.write(output);
} catch {
  // a hook that fails must not get in the way of the session
}
process.exit(0);
