// Fake agent CLIs for the end-to-end tests, in Node so they run on Windows, macOS and Linux.
// Each provider name gets a launcher on PATH (a .cmd on Windows, a shell script elsewhere)
// that runs the same agent with FAKE_NAME set to that name.
//
// What the fake agent does:
//   --version                 prints "<name> 9.9.9-fake"
//   a prompt with PLAYMAKER-OK  answers it (the doctor's smoke test), also into codex's -o file
//   a brief with "WRITE: <path>" writes that file and commits it (the board test)
//     "BREAK-FIRST" leaves a file named BAD on the first round, which the test gate rejects
//     "SLOW" waits a minute first, so a test can stop it while it runs
//   any other brief          writes <name>-was-here.txt and leaves the commit to the supervisor
import fs from 'node:fs';
import path from 'node:path';

const AGENT = String.raw`
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const name = process.env.FAKE_NAME || 'agent';
const argv = process.argv.slice(2);
const outAt = argv.indexOf('-o');
const out = outAt >= 0 ? argv[outAt + 1] : null;
const say = (text) => {
  console.log(text);
  if (out) fs.writeFileSync(out, text + '\n');
};

if (argv.includes('--version')) {
  console.log(name + ' 9.9.9-fake');
  process.exit(0);
}
if (argv.join(' ').includes('PLAYMAKER-OK')) {
  say('PLAYMAKER-OK');
  process.exit(0);
}
const briefFile = '.playmaker/brief.md';
if (!fs.existsSync(briefFile)) {
  console.error('no brief');
  process.exit(3);
}
const brief = fs.readFileSync(briefFile, 'utf8');
if (/^SLOW/m.test(brief)) await new Promise((r) => setTimeout(r, 60000));
const target = (brief.match(/^WRITE: (.+)$/m) || [])[1];
if (!target) {
  fs.writeFileSync(name + '-was-here.txt', name + '\n');
  say(name + ' report');
  console.log(name + ' stdout');
  process.exit(0);
}
const retry = brief.includes('Previous attempt failed');
fs.mkdirSync(target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : '.', { recursive: true });
fs.writeFileSync(target, target + ' by ' + name + (retry ? ', again' : '') + '\n');
if (retry) fs.rmSync('BAD', { force: true });
if (/^BREAK-FIRST/m.test(brief) && !retry) fs.writeFileSync('BAD', 'bad\n');
execFileSync('git', ['add', '-A'], { stdio: 'ignore' });
execFileSync('git', ['commit', '-q', '-m', 'feat: ' + target], { stdio: 'ignore' });
say('report for ' + target);
`;

/** Write the fake agent and one launcher per name into `bin`. Returns an env with `bin` first on PATH. */
export function installFakes(bin, names, extraEnv = {}) {
  fs.mkdirSync(bin, { recursive: true });
  const agent = path.join(bin, 'fake-agent.mjs');
  fs.writeFileSync(agent, AGENT);
  for (const name of names) {
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(bin, `${name}.cmd`), `@echo off\r\nset "FAKE_NAME=${name}"\r\n"${process.execPath}" "${agent}" %*\r\n`);
    } else {
      const file = path.join(bin, name);
      fs.writeFileSync(file, `#!/bin/sh\nFAKE_NAME=${name} exec "${process.execPath}" "${agent}" "$@"\n`);
      fs.chmodSync(file, 0o755);
    }
  }
  // Windows keeps the variable as "Path"; a second "PATH" key would leave which one wins to chance.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
  env.PATH = `${bin}${path.delimiter}${process.env.PATH || process.env.Path || ''}`;
  return { ...env, ...extraEnv };
}
