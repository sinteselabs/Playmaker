// The live board: a pane beside the conversation that shows a Playmaker run as it happens,
// and one line above the prompt while the pane is closed.
//
// It only reads .playmaker/ (through $.fs) and never writes it. Every button runs one of the
// plugin's commands, as if the user had typed it, so the manager agent stays the board's only
// writer and does the judgement. The pane opens with /playmaker, or by itself when a run starts
// (the "Live board" option turns that off).
import { computeReady, withDefaults } from '../scripts/lib/model.mjs';
import { PROVIDERS } from '../scripts/lib/providers.mjs';

const PANE = 'playmaker-board';
const PLUGIN = 'sintese-playmaker';
const POLL_MS = 3000;
const FINISHED = ['done', 'failed', 'error', 'timeout'];

// What the pane draws: null when this repository has no board, otherwise the last good read.
let view = null;
let signature = '';
let paneOpen = false;
let autoOpen = true;
// The run the pane already opened itself for, so closing it is respected for the rest of that run.
let autoOpenedRun = null;
// Tasks whose delivery was already shown as a toast; null until the first read sets the baseline.
let announced = null;

const label = (t) => PROVIDERS[t.provider]?.label || t.provider;
const firstLine = (s) => String(s || '').split('\n')[0];

/** Read the board and the status of each running worker. Keeps the last good view on a bad read. */
async function readView($) {
  const repo = await $.session.repo();
  if (!repo) return null;
  const dir = `${repo.root}/.playmaker`;
  if (!(await $.fs.exists(`${dir}/board.json`))) return null;
  let board;
  try {
    board = withDefaults(JSON.parse(await $.fs.read(`${dir}/board.json`)));
  } catch {
    return view;
  }
  const workers = {};
  for (const t of board.tasks) {
    if (t.status !== 'in_progress' || !t.worker || !board.run) continue;
    try {
      workers[t.id] = JSON.parse(await $.fs.read(`${dir}/runs/${board.run}/${t.worker}/status.json`));
    } catch {
      // the worker has not written its status yet
    }
  }
  return { board, ready: computeReady(board), workers, now: await $.clock.now() };
}

function minutesRunning(t, now) {
  const started = t.history.filter((h) => h.event === 'started').pop();
  return started ? Math.max(0, Math.round((now - Date.parse(started.at)) / 60000)) : 0;
}

/** Tasks delivered by now: folded into the board, or finished with changes and not synced yet. */
function deliveredIds(v) {
  return v.board.tasks
    .filter((t) => t.status === 'delivered' || (t.status === 'in_progress' && v.workers[t.id]?.state === 'done' && v.workers[t.id]?.filesChanged > 0))
    .map((t) => t.id);
}

/** The pane's content as plain data: sections of rows, each row with at most one action. */
export function layout(v) {
  const { board, ready, workers, now } = v;
  const having = (...statuses) => board.tasks.filter((t) => statuses.includes(t.status));
  const held = new Map(ready.blocked.map((x) => [x.id, x.why]));
  const running = having('in_progress');
  const sections = [
    {
      title: 'Running',
      rows: running.map((t) => {
        const finished = FINISHED.includes(workers[t.id]?.state);
        const round = t.round > 1 ? ` · round ${t.round}` : '';
        return { id: t.id, glyph: '●', color: 'yellow', detail: finished ? `${label(t)} finished, waiting for the manager` : `${label(t)} · ${minutesRunning(t, now)} min${round}` };
      }),
    },
    {
      title: 'Delivered, to review',
      rows: having('delivered').map((t) => ({ id: t.id, glyph: '◆', color: 'magenta', detail: `by ${label(t)}`, action: { label: 'Merge', skill: 'merge' } })),
    },
    {
      title: 'Next',
      rows: having('not_started', 'rework').map((t) => {
        const detail = ready.batch.includes(t.id) ? (t.status === 'rework' ? 'ready for another round' : 'ready to start') : held.get(t.id) || 'waiting';
        return { id: t.id, glyph: '○', color: undefined, detail };
      }),
    },
    {
      title: 'Parked',
      rows: having('refix', 'postponed').map((t) => ({
        id: t.id,
        glyph: '✗',
        color: 'red',
        detail: (t.status === 'refix' ? firstLine(t.feedback) : t.note) || t.status,
        action: { label: 'Retry', skill: 'retry' },
      })),
    },
    {
      title: 'To test',
      rows: having('to_test').map((t) => ({ id: t.id, glyph: '✓', color: 'green', detail: t.merged ? `merged ${t.merged.slice(0, 7)}` : 'merged', action: { label: 'Done', skill: 'done' } })),
    },
  ].filter((s) => s.rows.length);

  const done = having('done').length;
  const merged = done + having('to_test').length;
  const actions = [];
  if (!running.length && ready.batch.length) actions.push({ label: 'Go', skill: 'go', hotkey: 'g' });
  if (running.length) actions.push({ label: 'Stop', skill: 'stop', hotkey: 's' });
  actions.push({ label: 'Report', skill: 'board', hotkey: 'r' });
  return {
    header: `${merged} of ${board.tasks.length} merged · base ${board.base} · up to ${board.cap} at once`,
    sections,
    footer: done ? `${done} done` : '',
    actions,
  };
}

/** The one line above the prompt, or null when there is nothing worth a line. */
export function bandText(v) {
  const count = (s) => v.board.tasks.filter((t) => t.status === s).length;
  const running = count('in_progress');
  const review = count('delivered');
  if (!running && !review) return null;
  const parts = [running ? `${running} running` : '', review ? `${review} to review` : '', count('to_test') ? `${count('to_test')} to test` : ''].filter(Boolean);
  return `Playmaker: ${parts.join(' · ')}  (/playmaker shows the board)`;
}

/** Run one of the plugin's commands as if the user typed it; say what to type when that fails. */
async function runCommand($, skill, args) {
  try {
    await $.command.run({ command: `${PLUGIN}:${skill}`, args });
  } catch {
    $.ui.toast(`Type /${PLUGIN}:${skill}${args ? ` ${args}` : ''}`);
  }
}

async function openPane($, focus) {
  paneOpen = true;
  view = await readView($);
  await $.ui.open(focus ? { id: PANE, title: 'Playmaker', focus: true, closeOnEscape: true } : { id: PANE, title: 'Playmaker' });
}

/** One poll: read, show new deliveries as toasts, open the pane when a run starts, redraw on change. */
async function tick($) {
  view = await readView($);
  const next = view
    ? JSON.stringify([view.board.tasks.map((t) => [t.id, t.status, t.round]), Object.values(view.workers).map((w) => w.state), Math.floor(view.now / 60000)])
    : '';
  if (view) {
    const delivered = deliveredIds(view);
    if (announced) for (const id of delivered) if (!announced.has(id)) $.ui.toast(`Playmaker: ${id} delivered, waiting for review`);
    announced = new Set(delivered);
    const runActive = view.board.tasks.some((t) => t.status === 'in_progress');
    if (autoOpen && runActive && !paneOpen && view.board.run && autoOpenedRun !== view.board.run) {
      autoOpenedRun = view.board.run;
      await openPane($, false);
    }
  }
  if (next !== signature) {
    signature = next;
    $.ui.invalidate('ui.render');
  }
}

export function register(on, options) {
  autoOpen = options?.live_board !== false;

  on('session.start', async ($, e, next) => {
    view = await readView($);
    $.clock.every(POLL_MS, () => tick($));
    try {
      await $.command.register({ name: 'playmaker', description: 'Show or hide the Playmaker board', immediate: true });
    } catch {
      // another plugin owns the name: the pane still opens by itself when a run starts
    }
    return next(e);
  });

  on('command.run', { command: 'playmaker' }, async ($) => {
    if (paneOpen) {
      paneOpen = false;
      await $.ui.close({ id: PANE });
    } else {
      await openPane($, true);
    }
    return {};
  });

  // Never stands in the way of a pane closing, ours or another mod's.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) paneOpen = false;
    return next(e);
  }).catch(($, e, next) => next(e));

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e);
    const { Box, Text, Button } = $.ui.resolve(e);
    const act = (skill, args) => () => runCommand($, skill, args);

    if (!view) {
      return Box({
        flexDirection: 'column',
        children: [
          Text({ children: ['No Playmaker board in this repository yet.'] }),
          Text({ dimColor: true, children: ['Plan one to split work across the agent CLIs you have.'] }),
          Button({ key: 'plan', label: 'Plan', hotkey: 'p', onPress: act('plan', '') }),
        ],
      });
    }

    const l = layout(view);
    const children = [Text({ dimColor: true, wrap: 'truncate', children: [l.header] })];
    for (const section of l.sections) {
      children.push(Text({ children: [' '] }), Text({ bold: true, children: [`${section.title} (${section.rows.length})`] }));
      for (const row of section.rows) {
        const cells = [
          Text({ color: row.color, children: [row.glyph] }),
          Text({ bold: true, children: [row.id] }),
          Box({ flexGrow: 1, children: [Text({ dimColor: true, wrap: 'truncate', children: [row.detail] })] }),
        ];
        if (row.action) cells.push(Button({ key: `${row.action.skill}-${row.id}`, label: row.action.label, onPress: act(row.action.skill, row.id) }));
        children.push(Box({ flexDirection: 'row', columnGap: 1, children: cells }));
      }
    }
    if (l.footer) children.push(Text({ children: [' '] }), Text({ dimColor: true, children: [l.footer] }));
    children.push(
      Text({ children: [' '] }),
      Box({
        flexDirection: 'row',
        columnGap: 3,
        children: l.actions.map((a) => Button({ key: a.skill, label: a.label, hotkey: a.hotkey, plain: true, onPress: act(a.skill, '') })),
      })
    );
    return Box({ flexDirection: 'column', children });
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const line = !paneOpen && view ? bandText(view) : null;
    if (!line) return next(e);
    const { Text } = $.ui.resolve(e);
    return Text({ dimColor: true, wrap: 'truncate', children: [line] });
  });
}
