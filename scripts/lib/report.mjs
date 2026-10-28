// What a run tells project memory, as plain data and Markdown: the search terms that find what a
// task should know, the run's page, the retrospective, and the provider scorecard. Pure functions,
// no Node APIs; board.mjs does the file work and the manager agent does the Lore calls.
import { PROVIDERS } from './providers.mjs';

const GENERIC = new Set(['src', 'lib', 'app', 'apps', 'test', 'tests', 'spec', 'index', 'main', 'docs', 'packages', 'components', 'utils']);
const label = (provider) => PROVIDERS[provider]?.label || provider;
const firstLine = (s) => String(s || '').split('\n')[0].trim();
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Words to search project memory with before a task starts: its id, title and the names in what it owns. */
export function recallTerms(t, max = 8) {
  const words = [];
  const add = (w) => {
    const word = String(w).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (word.length > 2 && !GENERIC.has(word) && !words.includes(word)) words.push(word);
  };
  for (const part of String(t.id).split('-')) add(part);
  for (const w of String(t.title || '').split(/\s+/)) add(w);
  for (const p of t.owns || []) {
    for (const segment of String(p).replace(/\\/g, '/').split('/')) add(segment.replace(/\.[a-z0-9]+$/i, ''));
  }
  const terms = words.slice(0, max);
  return { task: t.id, terms, query: terms.join(' OR ') };
}

/** Minutes from a task's first start to its merge, or null when it never merged. */
export function minutesToMerge(t) {
  const started = (t.history || []).find((h) => h.event === 'started');
  const merged = (t.history || []).filter((h) => h.event === 'merged').pop();
  if (!started || !merged) return null;
  return Math.max(0, Math.round((Date.parse(merged.at) - Date.parse(started.at)) / 60000));
}

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The run's page for project memory: path, expiry, tags and a Markdown body. */
export function runPage(b, nowMs, keepDays = 7) {
  const rows = b.tasks.map(
    (t) => `| ${cell(t.id)} | ${cell(t.status)} | ${cell(label(t.provider))} | ${t.round || 0} | ${t.merged ? t.merged.slice(0, 8) : ''} | ${cell(firstLine(t.note || (['rework', 'refix'].includes(t.status) ? t.feedback : '')))} |`
  );
  const body = [
    `# Playmaker run ${b.run || '(not started)'}`,
    '',
    `Base \`${b.base}\`, up to ${b.cap} workers at once. Updated ${new Date(nowMs).toISOString()}.`,
    '',
    '| Task | Status | Provider | Rounds | Commit | Note |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    'Kept by the Playmaker manager while the run lasts. The board itself is `.playmaker/board.json` in the repository.',
  ].join('\n');
  return { path: `playmaker/${b.run || 'draft'}/board.md`, expires_at: isoDate(nowMs + keepDays * 86400000), tier: 'working', tags: ['playmaker', 'run'], body };
}

/** What happened in a run, per task, and the problems worth remembering. */
export function retro(b) {
  const tasks = b.tasks.map((t) => ({
    id: t.id,
    provider: t.provider,
    status: t.status,
    rounds: t.round || 0,
    failedRounds: (t.history || []).filter((h) => h.event === 'failed').length,
    minutes: minutesToMerge(t),
    commit: t.merged || null,
    problems: (t.history || []).filter((h) => h.event === 'failed').map((h) => firstLine(h.reason)),
  }));
  const count = (pred) => tasks.filter(pred).length;
  const merged = count((t) => ['to_test', 'done'].includes(t.status));
  const summary = {
    run: b.run || null,
    tasks: tasks.length,
    merged,
    mergedFirstTry: count((t) => ['to_test', 'done'].includes(t.status) && t.failedRounds === 0),
    parked: count((t) => t.status === 'refix'),
    notFinished: tasks.length - merged - count((t) => t.status === 'refix'),
  };
  const lines = [
    `# Playmaker run ${b.run || ''}: retrospective`,
    '',
    `${summary.merged} of ${summary.tasks} tasks merged, ${summary.mergedFirstTry} on the first round. ${summary.parked} parked as ReFix. ${summary.notFinished} not finished.`,
    '',
    '| Task | Provider | Status | Rounds | Failed rounds | Minutes to merge | Commit |',
    '|---|---|---|---|---|---|---|',
    ...tasks.map((t) => `| ${cell(t.id)} | ${cell(label(t.provider))} | ${t.status} | ${t.rounds} | ${t.failedRounds} | ${t.minutes ?? ''} | ${t.commit ? t.commit.slice(0, 8) : ''} |`),
  ];
  const troubled = tasks.filter((t) => t.problems.length);
  if (troubled.length) {
    lines.push('', '## What went wrong', '');
    for (const t of troubled) lines.push(`- **${t.id}** (${label(t.provider)}): ${t.problems.map(cell).join('; then ')}`);
  }
  return { summary, tasks, markdown: lines.join('\n') };
}

/** The scorecard entry for a task that just merged or was parked. */
export function scoreEntry(b, t, outcome, atIso) {
  return {
    run: b.run || null,
    task: t.id,
    provider: t.provider,
    kind: t.kind || null,
    outcome,
    rounds: t.round || 0,
    failedRounds: (t.history || []).filter((h) => h.event === 'failed').length,
    minutes: minutesToMerge(t),
    at: atIso,
  };
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** Per provider (and per provider and kind, where tasks have one): how often work merges, and how fast. */
export function scoreSummary(entries) {
  const groups = new Map();
  for (const e of entries) {
    for (const key of [e.provider, e.kind ? `${e.provider} · ${e.kind}` : null].filter(Boolean)) {
      if (!groups.has(key)) groups.set(key, { key, provider: e.provider, kind: key.includes(' · ') ? e.kind : null, tasks: 0, merged: 0, firstTry: 0, parked: 0, rounds: [], minutes: [] });
      const g = groups.get(key);
      g.tasks += 1;
      if (e.outcome === 'merged') {
        g.merged += 1;
        if (!e.failedRounds) g.firstTry += 1;
        if (e.minutes !== null) g.minutes.push(e.minutes);
      } else g.parked += 1;
      g.rounds.push(e.rounds);
    }
  }
  const rows = [...groups.values()]
    .map((g) => ({
      key: g.key,
      provider: g.provider,
      kind: g.kind,
      tasks: g.tasks,
      merged: g.merged,
      firstTryRate: g.tasks ? Math.round((100 * g.firstTry) / g.tasks) : 0,
      parked: g.parked,
      averageRounds: g.rounds.length ? Math.round((10 * g.rounds.reduce((a, b) => a + b, 0)) / g.rounds.length) / 10 : 0,
      medianMinutes: median(g.minutes),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const markdown = [
    '# Playmaker provider scorecard',
    '',
    `${entries.length} finished task(s): merged, or parked as ReFix after two failed rounds.`,
    '',
    '| Provider | Tasks | Merged | First round | Parked | Average rounds | Median minutes |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${cell(r.kind ? `${label(r.provider)} · ${r.kind}` : label(r.provider))} | ${r.tasks} | ${r.merged} | ${r.firstTryRate}% | ${r.parked} | ${r.averageRounds} | ${r.medianMinutes ?? ''} |`),
  ].join('\n');
  return { entries: entries.length, rows, markdown };
}
