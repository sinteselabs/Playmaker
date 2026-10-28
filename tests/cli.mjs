// The npm CLI: init, the script passthrough, help and version. Runs on Windows, macOS and Linux.
//   node tests/cli.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'cli', 'playmaker.mjs');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));

const cli = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'playmaker-cli-'));

// version and help --------------------------------------------------------
assert.equal(plugin.version, version, 'plugin.json and package.json carry the same version');
assert.equal(cli(['--version'], tmp).stdout.trim(), version);
assert.match(cli(['--help'], tmp).stdout, /^ {2}init /m);
assert.equal(cli([], tmp).status, 2, 'no command is a usage error');
assert.equal(cli(['nope'], tmp).status, 2, 'unknown command is a usage error');
assert.equal(cli(['init', '--agent', 'nope'], tmp).status, 2, 'unknown agent is a usage error');

// init --dry-run writes nothing --------------------------------------------
const dry = cli(['init', '--dry-run'], tmp);
assert.equal(dry.status, 0, dry.stderr);
assert.match(dry.stdout, /would create/);
assert.deepEqual(fs.readdirSync(tmp), [], 'dry run wrote nothing');

// init writes the skills where each agent reads them ------------------------
const first = cli(['init'], tmp);
assert.equal(first.status, 0, first.stderr);
for (const dir of ['.claude/skills', '.agents/skills']) {
  for (const skill of ['orchestrate', 'run']) {
    const file = path.join(tmp, dir, `playmaker-${skill}`, 'SKILL.md');
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, new RegExp(`^name: playmaker-${skill}$`, 'm'), `${file} is renamed`);
    assert.doesNotMatch(text, /CLAUDE_PLUGIN_ROOT/, `${file} does not depend on the plugin`);
    assert.doesNotMatch(text, /playmaker:(orchestrate|run)|sintese-playmaker/, `${file} names the copied skills`);
  }
}
const runSkill = fs.readFileSync(path.join(tmp, '.claude/skills/playmaker-run/SKILL.md'), 'utf8');
assert.ok(runSkill.includes(`npx -y playmakerlabs@${version} board`), 'board goes through the pinned CLI');
assert.ok(fs.existsSync(path.join(tmp, '.agents/skills/playmaker-orchestrate/references/board.md')), 'references are copied');

// a second init keeps every file, and never overwrites one -------------------
const mine = path.join(tmp, '.claude/skills/playmaker-run/SKILL.md');
fs.writeFileSync(mine, 'edited by the user\n');
const second = cli(['init'], tmp);
assert.equal(second.status, 0, second.stderr);
assert.doesNotMatch(second.stdout, /created/);
assert.match(second.stdout, /kept/);
assert.equal(fs.readFileSync(mine, 'utf8'), 'edited by the user\n');

// --agent installs only that agent's folder --------------------------------
const one = fs.mkdtempSync(path.join(os.tmpdir(), 'playmaker-cli-'));
assert.equal(cli(['init', '--agent', 'codex'], one).status, 0);
assert.deepEqual(fs.readdirSync(one), ['.agents']);

// the scripts behind the CLI -----------------------------------------------
const detect = cli(['detect'], tmp);
assert.equal(detect.status, 0, detect.stderr);
assert.doesNotThrow(() => JSON.parse(detect.stdout), 'detect prints JSON');
const board = cli(['board', 'validate'], tmp);
assert.notEqual(board.status, 0, 'board outside a git repository fails');
assert.match(board.stderr, /playmaker:/);

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(one, { recursive: true, force: true });
console.log('cli: ok');
