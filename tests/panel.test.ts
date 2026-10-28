// The live board pane (hooks/panel.js), with no session: the board and the worker statuses are
// stubbed file reads, the clock is the kit's mock, and button presses are checked as the
// commands they would run.
//   claude plugin test
import { expect, mock, test } from 'claude-code/testing'

const ROOT = '/repo'
const minutesAgo = (n: number) => new Date(Date.UTC(2026, 9, 28, 12, 0) - n * 60000).toISOString()
const NOW = Date.UTC(2026, 9, 28, 12, 0)

const BOARD = {
  base: 'main',
  cap: 3,
  run: 'b1',
  tasks: [
    { id: 'api', provider: 'codex', status: 'in_progress', worker: 'api', owns: ['src/api/'], history: [{ at: minutesAgo(7), event: 'started' }] },
    { id: 'ui', provider: 'gemini', status: 'delivered', owns: ['src/ui/'] },
    { id: 'docs', provider: 'claude', status: 'not_started', deps: ['api'], owns: ['docs/'] },
    { id: 'cache', provider: 'claude', status: 'refix', feedback: 'gate failed: npm test\nmore', owns: ['src/cache/'] },
    { id: 'auth', provider: 'claude', status: 'to_test', merged: 'abcdef1234', owns: ['src/auth/'] },
    { id: 'old', provider: 'claude', status: 'done', owns: ['old/'] },
  ],
}

const PANE = {
  plugin: 'sintese-playmaker',
  component: 'Pane',
  requestId: 'playmaker-board',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'Playmaker', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const BAND = {
  plugin: 'sintese-playmaker',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 160, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

/** Stub everything the mod reaches: the repository, its files, the clock, commands and the pane. */
function world(on, files: Record<string, unknown>) {
  const ran: { command: string; args?: string }[] = []
  const toasts: string[] = []
  const opened: unknown[] = []
  let closed = 0
  const clock = mock.clock(on, { now: NOW })
  on('session.start', () => ({ cwd: ROOT }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  // Paths arrive absolute, with backslashes on Windows
  const find = (p: string) => Object.keys(files).find((f) => p.replace(/\\/g, '/').endsWith(f))
  on('fs.exists', ($, e) => ({ value: Boolean(find(e.path)) }))
  on('fs.read', ($, e) => {
    const hit = find(e.path)
    return hit ? { value: JSON.stringify(files[hit]) } : { deny: 'no such file' }
  })
  on('command.register', () => ({ value: undefined }))
  on('command.run', ($, e) => {
    ran.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  on('ui.open', ($, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    closed += 1
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  return { ran, toasts, opened, clock, closed: () => closed }
}

const start = ($) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })

test('without a board, the pane offers to plan one', async ($, on) => {
  const w = world(on, {})
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'No Playmaker board in this repository yet.' })).toBeDefined()
  await ui.press({ key: 'plan' })
  expect(w.ran).toEqual([{ command: 'sintese-playmaker:plan', args: '' }])
})

test('the pane shows each task where it stands, with the action that fits', async ($, on) => {
  const w = world(on, { '.playmaker/board.json': BOARD, 'runs/b1/api/status.json': { state: 'running' } })
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: '2 of 6 merged · base main · up to 3 at once' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Running (1)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Codex CLI · 7 min' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Delivered, to review (1)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'waiting for api to be merged' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'gate failed: npm test' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'merged abcdef1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1 done' })).toBeDefined()
    expect(await ui.find({ key: 'stop' })).toBeDefined()
    expect(await ui.find({ key: 'go' })).toBeUndefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'merge-ui' })
  await ui.press({ key: 'retry-cache' })
  await ui.press({ key: 'done-auth' })
  await ui.press({ key: 'stop' })
  expect(w.ran).toEqual([
    { command: 'sintese-playmaker:merge', args: 'ui' },
    { command: 'sintese-playmaker:retry', args: 'cache' },
    { command: 'sintese-playmaker:done', args: 'auth' },
    { command: 'sintese-playmaker:stop', args: '' },
  ])
})

test('with the pane closed, one line above the prompt sums up the run', async ($, on) => {
  world(on, { '.playmaker/board.json': BOARD })
  await start($)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^Playmaker: 1 running · 1 to review · 1 to test/ })).toBeDefined()
})

test('a run that starts opens the pane once, and a delivery shows a toast', async ($, on) => {
  const idle = { ...BOARD, tasks: BOARD.tasks.map((t) => (t.id === 'api' ? { ...t, status: 'not_started', worker: undefined } : t)) }
  const files: Record<string, unknown> = { '.playmaker/board.json': idle }
  const w = world(on, files)
  await start($)
  await w.clock.advance(3000)
  expect(w.opened).toEqual([])

  files['.playmaker/board.json'] = BOARD
  files['runs/b1/api/status.json'] = { state: 'running' }
  await w.clock.advance(3000)
  expect(w.opened.length).toBe(1)
  await w.clock.advance(3000)
  expect(w.opened.length).toBe(1)

  files['runs/b1/api/status.json'] = { state: 'done', filesChanged: 2 }
  await w.clock.advance(3000)
  expect(w.toasts).toEqual(['Playmaker: api delivered, waiting for review'])
})

test('/playmaker shows the pane with focus, and hides it the second time', async ($, on) => {
  const w = world(on, { '.playmaker/board.json': BOARD })
  await start($)
  await $.command.run({ command: 'playmaker', args: '' })
  expect(w.opened).toEqual([{ id: 'playmaker-board', title: 'Playmaker', focus: true, closeOnEscape: true }])
  await $.command.run({ command: 'playmaker', args: '' })
  expect(w.closed()).toBe(1)
})
