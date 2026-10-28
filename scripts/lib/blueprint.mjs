// Reading a Blueprint plan: its tasks, in phases, each with a spec of its own. Pure functions, no
// Node APIs. Blueprint writes its documents in the project's language, so nothing here depends on
// a heading's wording: a task is a numbered line that names its spec in backticks, a phase is the
// heading above it, and a spec's situation is the second bold label of its first metadata line.

/** The plan's tasks, in order: `{ phase, title, summary, spec }`. */
export function parsePlan(text) {
  const tasks = [];
  let phase = null;
  for (const line of String(text).split(/\r?\n/)) {
    const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (heading) {
      phase = heading[1];
      continue;
    }
    const item = line.match(/^\s*\d+\.\s+(.*`([^`]+\.md)`.*)$/);
    if (!item || !/(^|\/)specs\//.test(item[2])) continue;
    const before = item[1].slice(0, item[1].indexOf('`')).replace(/[\s.:—-]+[^\s.:—-]*:?\s*$/, '');
    const colon = before.indexOf(':');
    tasks.push({
      phase,
      title: (colon >= 0 ? before.slice(0, colon) : before).trim(),
      summary: colon >= 0 ? before.slice(colon + 1).trim().replace(/\.$/, '') : '',
      spec: item[2],
    });
  }
  return tasks;
}

/** What the first metadata line of a spec says about where the task stands, as written. */
export function specSituation(text) {
  const meta = String(text).split(/\r?\n/).find((l) => /^\*\*[^*]+:\*\*/.test(l.trim()));
  const labels = meta ? [...meta.matchAll(/\*\*[^*]+:\*\*\s*([^·*]+)/g)].map((m) => m[1].trim()) : [];
  return labels[1] || null;
}

/** A board task id from a spec's file name: `specs/01-02-users-api.md` gives `01-02-users-api`. */
export function idFromSpec(spec) {
  const stem = String(spec).split('/').pop().replace(/\.md$/i, '');
  let id = stem
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 31).replace(/-$/, '');
  if (/-r\d+$/.test(id)) id = `${id}x`;
  return id || 'task';
}
