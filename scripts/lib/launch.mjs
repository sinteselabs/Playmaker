// Creating and starting one worker: git worktree, branch, brief, detached supervisor.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROVIDERS, PROVIDER_IDS, WORKER_PROMPT } from './providers.mjs';
import { git, tryGit, which, writeJsonAtomic } from './util.mjs';

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;
const SUPERVISOR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'spawn.mjs');

export function ensureExcluded(root) {
  const common = git(root, 'rev-parse', '--git-common-dir');
  const excludeFile = path.join(path.resolve(root, common), 'info', 'exclude');
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  const current = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
  if (!current.split(/\r?\n/).includes('.playmaker/')) {
    fs.appendFileSync(excludeFile, `${current && !current.endsWith('\n') ? '\n' : ''}.playmaker/\n`);
  }
}

export function workerFooter(w, gates = [], lore = false) {
  const lines = [
    '',
    '---',
    'Playmaker rules (added automatically)',
    `- You are worker "${w.id}" of run "${w.run}", in a git worktree on branch ${w.branch}. Work only there.`,
    '- Do one task: the one above. Do not pick up other tasks and do not start other agents.',
    '- Commit your work on this branch with a conventional commit message (feat:, fix:, test:, docs:, refactor:). A final commit by the supervisor picks up anything you leave uncommitted.',
    '- Do not merge, push, checkout, switch or reset, and do not touch any other worktree.',
    '- Do not edit files outside the scope above. If the task needs that, stop and say so in your report instead.',
  ];
  if (gates.length) {
    lines.push('- Gates you must run and pass before reporting:');
    for (const g of gates) lines.push(`    ${g}`);
  }
  if (lore) {
    lines.push(
      `- If you have Lore memory tools (mcp__lore__*), declare your work at the start with a page at playmaker/${w.run}/${w.id}.md (what you are doing, which files), and close it at the end with what you built. If you do not have them, skip this: your report is enough.`
    );
  }
  lines.push(
    '- Finish with a report that states: what you built, the commit hash, each gate you ran with a summary of its real output, anything you could not do or did not verify, and any decision you took that the user would normally take.',
    ''
  );
  return lines.join('\n');
}

/** Build the full record for one worker without touching the filesystem or git state. */
export function makeWorker(root, spec) {
  const provider = PROVIDERS[spec.provider];
  if (!provider) throw new Error(`unknown provider "${spec.provider}" for "${spec.id}". Known: ${PROVIDER_IDS.join(', ')}.`);
  if (!ID_RE.test(spec.id || '')) throw new Error(`invalid worker id "${spec.id}". Use lowercase letters, digits and dashes.`);
  if (!spec.brief || !spec.brief.trim()) throw new Error(`worker "${spec.id}" has no brief.`);

  const startPoint = spec.startPoint || 'HEAD';
  const baseSha = tryGit(root, 'rev-parse', '--verify', startPoint);
  if (!baseSha) throw new Error(`cannot resolve "${startPoint}".`);

  const workerDir = path.join(root, '.playmaker', 'runs', spec.run, spec.id);
  const w = {
    id: spec.id,
    run: spec.run,
    provider: spec.provider,
    branch: `playmaker/${spec.run}/${spec.id}`,
    worktree: path.join(path.dirname(root), `${path.basename(root)}-playmaker`, spec.run, spec.id),
    workerDir,
    base: startPoint,
    baseSha,
    timeoutMin: spec.timeoutMin || 30,
    commit: spec.commit !== false,
    brief: spec.brief,
    installed: Boolean(which(provider.bin)),
    command: provider.bin,
  };
  w.args = provider.build({
    prompt: WORKER_PROMPT,
    model: spec.model || '',
    allow: spec.allow || [],
    extra: spec.extraArgs || [],
    resultPath: path.join(workerDir, 'result.md'),
  });
  return w;
}

/** Refuse to start when the branch or worktree path is already taken. */
export function checkFree(root, w) {
  if (tryGit(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${w.branch}`)) throw new Error(`branch ${w.branch} already exists.`);
  if (fs.existsSync(w.worktree)) throw new Error(`${w.worktree} already exists.`);
}

/** Create the worktree and branch, write the brief, start the detached supervisor. */
export function startWorker(root, w, { gates = [], lore = false } = {}) {
  checkFree(root, w);
  ensureExcluded(root);
  fs.mkdirSync(path.dirname(w.worktree), { recursive: true });
  git(root, 'worktree', 'add', '-b', w.branch, w.worktree, w.baseSha);
  fs.mkdirSync(path.join(w.worktree, '.playmaker'), { recursive: true });
  const brief = w.brief.trimEnd() + '\n' + workerFooter(w, gates, lore);
  fs.writeFileSync(path.join(w.worktree, '.playmaker', 'brief.md'), brief);

  fs.mkdirSync(w.workerDir, { recursive: true });
  fs.writeFileSync(path.join(w.workerDir, 'brief.md'), brief);
  const { brief: _brief, installed: _installed, ...record } = w;
  writeJsonAtomic(path.join(w.workerDir, 'worker.json'), { ...record, createdAt: new Date().toISOString() });
  writeJsonAtomic(path.join(w.workerDir, 'status.json'), { state: 'queued' });

  const sup = spawn(process.execPath, [SUPERVISOR, '--supervise', w.workerDir], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  sup.unref();
}

export function removeWorktree(root, worktree) {
  if (fs.existsSync(worktree)) tryGit(root, 'worktree', 'remove', '--force', worktree);
  tryGit(root, 'worktree', 'prune');
}
