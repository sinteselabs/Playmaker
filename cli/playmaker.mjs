#!/usr/bin/env node
// The Playmaker CLI, for agents that load skills from a project folder instead of a plugin.
//   playmaker init [--dry-run] [--agent claude|codex|antigravity]
//   playmaker board|status|spawn|detect|doctor [args]   the plugin's scripts, unchanged
//
// `init` copies the skills where each agent reads them. Inside the plugin the skills call
// `node "${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs"`; the copies call this CLI instead,
// pinned to the version that wrote them, so skills and scripts never drift apart.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { name: PACKAGE_NAME, version } = JSON.parse(fs.readFileSync(path.join(PACKAGE, 'package.json'), 'utf8'));

const SCRIPTS = { board: 'board.mjs', status: 'status.mjs', spawn: 'spawn.mjs', detect: 'detect-agents.mjs', doctor: 'doctor.mjs' };
const AGENTS = { claude: '.claude/skills', codex: '.agents/skills', antigravity: '.agents/skills' };
const SKILLS = fs
  .readdirSync(path.join(PACKAGE, 'skills'))
  .filter((s) => fs.existsSync(path.join(PACKAGE, 'skills', s, 'SKILL.md')))
  .sort();

const usage = `playmaker ${version}

Usage: playmaker <command> [options]

  init      copy the Playmaker skills into this project
              --dry-run   say what would be written, write nothing
              --agent     claude, codex or antigravity (default: all)
  board     the task board: validate, show, ready, start, wait, sync, integrate,
            reject, retry, stop, set, report
  status    state of the workers of a run [run] [--json] [--overlap]
  spawn     one-batch launcher: --plan plan.json [--dry-run]
  detect    which agent CLIs are installed
  doctor    check node, git, the board and each agent CLI [--gates] [--smoke]

  --help    this text
  --version the version

Installed as a Claude Code plugin, Playmaker needs none of this: the plugin
carries the skills, the scripts, the hooks and the monitor.`;

/**
 * Skill text as it should read outside the plugin, for the skills folder `target`:
 * prefixed names, paths between skills relative to the project, scripts called through this CLI.
 */
export function forProject(text, target = '.claude/skills') {
  const cli = `npx -y ${PACKAGE_NAME}@${version}`;
  const command = Object.fromEntries(Object.entries(SCRIPTS).map(([cmd, file]) => [file, cmd]));
  return text
    .replace(/^name: ([a-z-]+)(?=\r?$)/m, 'name: playmaker-$1')
    .replace(/\/?sintese-playmaker:([a-z][a-z-]*)/g, 'playmaker-$1')
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/([a-z-]+)\//g, `${target}/playmaker-$1/`)
    .replace(/node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/([a-z-]+\.mjs)"/g, (match, file) => (command[file] ? `${cli} ${command[file]}` : match));
}

function filesUnder(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const here = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(here));
    else if (entry.isFile()) found.push(here);
  }
  return found;
}

export function init(argv, folder, write) {
  let pretend = false;
  let agent = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') pretend = true;
    else if (argv[i] === '--agent') {
      agent = (argv[++i] || '').toLowerCase();
      if (!AGENTS[agent]) {
        write(`--agent takes one of: ${Object.keys(AGENTS).join(', ')}`);
        return 2;
      }
    } else {
      write(`unknown option ${argv[i]}\n\n${usage}`);
      return 2;
    }
  }

  const wanted = agent ? [agent] : Object.keys(AGENTS);
  const targets = [...new Set(wanted.map((a) => AGENTS[a]))];
  // Each file to copy: where it comes from, where it goes, and the skills folder its links resolve against.
  const copies = [];
  for (const target of targets) {
    for (const skill of SKILLS) {
      const from = path.join(PACKAGE, 'skills', skill);
      for (const file of filesUnder(from)) copies.push({ file, rel: path.join(...target.split('/'), `playmaker-${skill}`, path.relative(from, file)), target });
    }
  }
  // Claude Code also reads subagents from the project: the reviewer the go and merge skills call.
  if (wanted.includes('claude')) {
    for (const file of filesUnder(path.join(PACKAGE, 'agents'))) {
      copies.push({ file, rel: path.join('.claude', 'agents', `playmaker-${path.basename(file)}`), target: AGENTS.claude });
    }
  }
  let created = 0;
  let kept = 0;
  for (const { file, rel, target } of copies) {
    const dest = path.join(folder, rel);
    if (fs.existsSync(dest)) {
      kept += 1;
      continue;
    }
    created += 1;
    write(`  ${pretend ? 'would create' : 'created'}  ${rel.split(path.sep).join('/')}`);
    if (pretend) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, forProject(fs.readFileSync(file, 'utf8'), target));
  }
  if (kept) write(`  kept     ${kept} file${kept === 1 ? '' : 's'} that were already there`);
  write(pretend ? `\nPlaymaker ${version}: ${created} file(s) would be written. Nothing was written.` : `\nPlaymaker ${version}: ${created} file(s) written.`);
  if (!pretend) {
    write(`The skills are ${SKILLS.map((s) => `playmaker-${s}`).join(', ')}.`);
    write('The hooks that offer a parallel run on their own, and the monitor that announces deliveries, come only with the Claude Code plugin.');
  }
  return 0;
}

export function run(argv, folder, write) {
  const [command, ...rest] = argv;
  if (!command || ['--help', '-h', 'help'].includes(command)) {
    write(usage);
    return command ? 0 : 2;
  }
  if (command === '--version' || command === '-v') {
    write(version);
    return 0;
  }
  if (command === 'init') return init(rest, folder, write);
  if (SCRIPTS[command]) {
    const args = command === 'detect' && !rest.length ? ['--print'] : rest;
    const child = spawnSync(process.execPath, [path.join(PACKAGE, 'scripts', SCRIPTS[command]), ...args], { cwd: folder, stdio: 'inherit' });
    return child.status ?? 1;
  }
  write(`unknown command ${command}\n\n${usage}`);
  return 2;
}

// Run only when called, not when a test imports it. realpath because npm links the bin.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = run(process.argv.slice(2), process.cwd(), (line) => process.stdout.write(`${line}\n`));
}
