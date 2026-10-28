// End-to-end test of where tasks come from and where they go: a draft board from a Blueprint plan
// written in Portuguese, the "How to test" a delivery carries, and the list of what is left to test.
// Runs on Windows, macOS and Linux.
//   node tests/integrations.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installFakes } from './lib/fakes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOARD = path.join(ROOT, 'scripts', 'board.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'playmaker-integrations-'));
const repo = path.join(tmp, 'proj');
fs.mkdirSync(path.join(repo, 'docs', 'specs'), { recursive: true });
const env = installFakes(path.join(tmp, 'bin'), ['claude', 'codex'], { CLAUDE_PLUGIN_DATA: path.join(tmp, 'data') });

const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
const run = (...args) => spawnSync(process.execPath, [BOARD, ...args], { cwd: repo, env, encoding: 'utf8' });
const json = (r) => JSON.parse(r.stdout);
const boardFile = path.join(repo, '.playmaker', 'board.json');
const task = (id) => json(run('show', '--json')).tasks.find((t) => t.id === id);
const write = (rel, text) => fs.writeFileSync(path.join(repo, ...rel.split('/')), text);

// A plan as Blueprint writes it, in the project's language
write(
  'docs/plan.md',
  [
    '# Plano',
    '',
    '**Projeto:** Loja · **Versão:** 0.1',
    '',
    '## Tarefas',
    '',
    '### Fase 1 · Base',
    '',
    '1. Tabela de usuários: cria a tabela e a migração. Especificação: `specs/01-01-tabela-usuarios.md`',
    '2. Login: entra com e-mail e senha. Especificação: `specs/01-02-login.md`',
    '',
    '### Fase 2 · Jornada',
    '',
    '1. Painel: mostra o resumo do pedido. Especificação: `specs/02-01-painel.md`',
    '',
    '## O que depende de pessoas',
    '',
    '- Nada.',
  ].join('\n')
);
const spec = (name, situation) => `# ${name}\n\n**Fase:** 1 · Base · **Situação:** ${situation}\n\n## O que faz\n\n${name} pronto.\n\n## Pronto quando\n\n- [ ] funciona\n`;
write('docs/specs/01-01-tabela-usuarios.md', spec('Tabela de usuários', 'não iniciada'));
write('docs/specs/01-02-login.md', spec('Login', 'concluída'));
write('docs/specs/02-01-painel.md', spec('Painel', 'não iniciada'));

g('init', '-q', '-b', 'main');
g('config', 'user.email', 'integrations@example.com');
g('config', 'user.name', 'Integrations');
g('add', '-A');
g('commit', '-q', '-m', 'init');

// 1. import: a draft board, one task per spec, phases as waves ---------------------------------------
let r = run('import', 'docs/plan.md');
assert.equal(r.status, 0, r.stderr);
assert.match(r.stderr, /3 task\(s\) in 2 phase\(s\) from docs\/plan\.md/);
const draft = json(r);
assert.equal(draft.base, 'main');
assert.deepEqual(draft.source, { plan: 'docs/plan.md' });
assert.deepEqual(
  draft.tasks.map((t) => [t.id, t.title, t.phase]),
  [
    ['01-01-tabela-usuarios', 'Tabela de usuários', 'Fase 1 · Base'],
    ['01-02-login', 'Login', 'Fase 1 · Base'],
    ['02-01-painel', 'Painel', 'Fase 2 · Jornada'],
  ]
);
assert.deepEqual(draft.tasks[0].deps, []);
assert.deepEqual(draft.tasks[2].deps, ['01-01-tabela-usuarios', '01-02-login'], 'the second phase waits for the first');
assert.deepEqual(draft.tasks[0].owns, ['docs/specs/01-01-tabela-usuarios.md']);
assert.equal(draft.tasks[1].situation, 'concluída', 'the situation is passed on as written');
assert.match(draft.tasks[0].brief, /^# Tabela de usuários[\s\S]*## When you deliver[\s\S]*docs\/specs\/01-01-tabela-usuarios\.md/);
assert.equal(fs.existsSync(boardFile), false, 'without --write nothing is written');

// plans outside the repository, so main stays clean
fs.writeFileSync(path.join(tmp, 'broken.md'), '1. Algo: faz algo. Spec: `specs/99-01-nao-existe.md`\n');
r = run('import', path.join(tmp, 'broken.md'));
assert.notEqual(r.status, 0);
assert.match(r.stderr, /names specs\/99-01-nao-existe\.md, which does not exist/);
fs.writeFileSync(path.join(tmp, 'empty.md'), '# Plano\n\nNada aqui.\n');
assert.match(run('import', path.join(tmp, 'empty.md')).stderr, /found no task in the plan/);
assert.notEqual(run('import', 'docs/plan.md', '--provider', 'nope').status, 0);

r = run('import', 'docs/plan.md', '--write');
assert.equal(r.status, 0, r.stderr);
assert.ok(fs.existsSync(boardFile));
assert.equal(run('import', 'docs/plan.md', '--write').status, 2, 'an existing board is never overwritten');

// 2. the manager completes the draft; the worker reports how to test --------------------------------
const board = JSON.parse(fs.readFileSync(boardFile, 'utf8'));
board.gates = [`node -e "process.exit(0)"`];
board.tasks = board.tasks.filter((t) => t.situation !== 'concluída');
board.tasks[1].deps = ['01-01-tabela-usuarios'];
board.tasks[0].owns.push('src/db/');
board.tasks[0].brief += '\nWRITE: src/db/users.sql\nHOWTO: run npm run migrate and see the users table\n';
board.tasks[1].owns.push('src/painel/');
board.tasks[1].brief += '\nWRITE: src/painel/painel.txt\n';
fs.writeFileSync(boardFile, JSON.stringify(board, null, 2));
r = run('validate');
assert.equal(r.status, 0, r.stderr);

r = run('start');
assert.equal(r.status, 0, r.stderr + r.stdout);
const brief = fs.readFileSync(path.join(task('01-01-tabela-usuarios').worktree, '.playmaker', 'brief.md'), 'utf8');
assert.match(brief, /section headed exactly "How to test"/, 'every worker is asked for it');
for (let i = 0; i < 120 && task('01-01-tabela-usuarios').status === 'in_progress'; i += 1) {
  await sleep(500);
  run('sync');
}
r = run('integrate', '01-01-tabela-usuarios');
assert.equal(r.status, 0, r.stderr + r.stdout);
assert.equal(task('01-01-tabela-usuarios').howToTest, 'run npm run migrate and see the users table', 'taken from the report, up to the next heading');

run('start');
for (let i = 0; i < 120 && task('02-01-painel').status === 'in_progress'; i += 1) {
  await sleep(500);
  run('sync');
}
r = run('integrate', '02-01-painel');
assert.equal(r.status, 0, r.stderr + r.stdout);
assert.equal(task('02-01-painel').howToTest, undefined, 'no section in the report, no how-to-test');

// 3. the list of what is left to test ------------------------------------------------------------------
r = run('totest');
assert.match(r.stdout, /## 01-01-tabela-usuarios · Tabela de usuários \(commit [0-9a-f]{8}\)\n\nrun npm run migrate and see the users table\n\nSpec: `docs\/specs\/01-01-tabela-usuarios\.md`/);
assert.match(r.stdout, /## 02-01-painel · Painel[\s\S]*said nothing about how to test it/);

fs.writeFileSync(path.join(tmp, 'howto.md'), 'open the dashboard and see the order summary\n');
assert.notEqual(run('howto', '02-01-painel').status, 0, 'howto needs --file');
r = run('howto', '02-01-painel', '--file', path.join(tmp, 'howto.md'));
assert.equal(r.status, 0, r.stderr);
const list = json(run('totest', '--json'));
assert.deepEqual(
  list.tasks.map((t) => [t.id, t.howToTest]),
  [
    ['01-01-tabela-usuarios', 'run npm run migrate and see the users table'],
    ['02-01-painel', 'open the dashboard and see the order summary'],
  ]
);

run('set', '01-01-tabela-usuarios', 'done', '--confirmed-by-user');
run('set', '02-01-painel', 'done', '--confirmed-by-user');
assert.match(run('totest').stdout, /Nothing is waiting to be tested\./);

console.log('integrations test passed');
fs.rmSync(tmp, { recursive: true, force: true });
