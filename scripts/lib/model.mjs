// The board's model: defaults, collisions and the ready set. Pure functions, no Node APIs,
// so board.mjs and the live board pane (hooks/panel.js, which runs without Node) share one copy.

export const STATUSES = ['not_started', 'in_progress', 'delivered', 'rework', 'to_test', 'refix', 'done', 'postponed'];
export const MERGED = new Set(['to_test', 'done']);

/** Fill in the defaults a board may leave out. Changes `b` in place and returns it. */
export function withDefaults(b) {
  b.base = b.base || 'main';
  b.cap = b.cap || 4;
  b.gates = b.gates || [];
  b.sharedFiles = b.sharedFiles || [];
  b.timeoutMin = b.timeoutMin || 30;
  b.tasks = b.tasks || [];
  for (const t of b.tasks) {
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

export const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
export const pathsOverlap = (x, y) => x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);

/** Why two tasks cannot run at the same time, or null when they can. */
export function collides(a, b) {
  for (const x of a.owns) for (const y of b.owns) if (pathsOverlap(norm(x), norm(y))) return `both edit ${norm(x)}`;
  for (const s of a.shared) if (b.shared.includes(s)) return `both need shared file ${s}`;
  for (const r of a.resources) if (b.resources.includes(r)) return `both need resource ${r}`;
  return null;
}

/** What is running, what could start now (the batch), and why every other waiting task is held. */
export function computeReady(b) {
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
