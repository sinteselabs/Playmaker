// Shared helpers. Plain Node, no dependencies, works on Windows, macOS and Linux.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const isWin = process.platform === 'win32';

export function dataDir() {
  const dir = process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'playmaker-data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function readStdinJson() {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8').trim();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/** Find an executable on PATH without spawning a subprocess. Returns the full path or null. */
export function which(bin, env = process.env) {
  const exts = isWin ? (env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  for (const dir of (env.PATH || env.Path || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext);
      try {
        const st = fs.statSync(candidate);
        if (!st.isFile()) continue;
        if (!isWin && (st.mode & 0o111) === 0) continue;
        return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

export function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function tryGit(cwd, ...args) {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
}

export function repoRoot(cwd = process.cwd()) {
  const top = tryGit(cwd, 'rev-parse', '--show-toplevel');
  return top ? path.resolve(top) : null;
}

export function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Quote one argument for cmd.exe. Used only on Windows, where npm CLIs are .cmd shims that need a shell. */
export function quoteWin(arg) {
  const escaped = String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1');
  return `"${escaped}"`;
}

export function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

export function killTree(pid) {
  if (!pid) return;
  try {
    if (isWin) {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        process.kill(pid, 'SIGTERM');
      }
    }
  } catch {
    /* already gone */
  }
}

export function hookOutput(eventName, additionalContext) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext } });
}

/**
 * A plugin option. hooks.json passes each one as an argument (`--proactive ${user_config.proactive}`).
 * The copy Claude Code also exports to the environment is read by its literal name, only when the
 * argument is missing or was not substituted.
 */
export function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  let raw = i >= 0 ? process.argv[i + 1] : undefined;
  if (raw === undefined || raw === '' || raw.includes('${')) {
    if (name === 'proactive') raw = process.env.CLAUDE_PLUGIN_OPTION_PROACTIVE;
    else if (name === 'min_tasks') raw = process.env.CLAUDE_PLUGIN_OPTION_MIN_TASKS;
  }
  return raw === undefined || raw === '' ? fallback : raw;
}
