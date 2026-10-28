// Pull requests through the GitHub CLI, for boards with "integration": "pr". Each call returns
// plain data or null, never throws: a gh that is missing, logged out or offline is reported by the
// caller, and the board stays as it was.
import { runCommand, which } from './util.mjs';

const FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);

export const ghInstalled = () => Boolean(which('gh'));

/** Open a PR from `head` into `base`. Returns `{ url }`, or `{ error }` with what gh said. */
export function openPr({ cwd, base, head, title, bodyFile }) {
  const r = runCommand('gh', ['pr', 'create', '--base', base, '--head', head, '--title', title, '--body-file', bodyFile], { cwd, timeout: 60000 });
  const url = (r.stdout || '').match(/https?:\/\/\S+\/pull\/\d+/)?.[0];
  return r.status === 0 && url ? { url } : { error: `${r.stdout || ''}${r.stderr || ''}`.trim() || r.error?.message || `gh exited ${r.status}` };
}

/**
 * Where a PR stands: `state` (OPEN, MERGED, CLOSED), the merge commit, and what would send the task
 * back: the latest review that asked for changes, and the checks that failed. Null when gh cannot tell.
 */
export function prState(url, cwd) {
  const r = runCommand('gh', ['pr', 'view', url, '--json', 'state,mergeCommit,reviewDecision,reviews,statusCheckRollup'], { cwd, timeout: 30000 });
  if (r.status !== 0) return null;
  let pr;
  try {
    pr = JSON.parse(r.stdout);
  } catch {
    return null;
  }
  const asked = (pr.reviews || []).filter((x) => x.state === 'CHANGES_REQUESTED').pop();
  const checks = pr.statusCheckRollup || [];
  return {
    state: pr.state,
    mergeCommit: pr.mergeCommit?.oid || null,
    changesRequested: pr.reviewDecision === 'CHANGES_REQUESTED' ? (asked?.body || '').trim() || 'a reviewer asked for changes' : null,
    checksFailed: checks.filter((c) => FAILED.has(c.conclusion) || FAILED.has(c.state)).map((c) => c.name || c.context || 'a check'),
  };
}

/** Close a PR with a comment saying why. Returns whether gh did it. */
export function closePr(url, comment, cwd) {
  return runCommand('gh', ['pr', 'close', url, '--comment', comment], { cwd, timeout: 30000 }).status === 0;
}

/** Why the task should go back for another round, from a PR's state; null while it should wait. */
export function prSetback(s) {
  if (s.state === 'CLOSED') return 'the pull request was closed without merging';
  if (s.changesRequested) return `changes were requested on the pull request: ${s.changesRequested}`;
  if (s.checksFailed.length) return `checks failed on the pull request: ${s.checksFailed.join(', ')}`;
  return null;
}
