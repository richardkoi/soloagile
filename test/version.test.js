import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVED_FOLDER } from './isolate.js';
import { buildProject } from '../src/build.js';
import { refreshOldPage } from '../src/session.js';
import { ROOT, VERSION, builtBy, compareVersions, newerInstall } from '../src/version.js';

const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'soloagile');
const tmp = () => mkdtempSync(join(tmpdir(), 'pm-version-'));

function pmProject(parent = tmp(), name = 'alpha') {
  const repo = join(parent, name);
  mkdirSync(join(repo, 'pm'), { recursive: true });
  writeFileSync(join(repo, 'pm', 'board.md'), '# Board\n<!-- next-id: 2 -->\n## Up next\n- #1 A card · M1 · 1 pt\n## Done\n');
  writeFileSync(join(repo, 'pm', 'plan.md'), `# ${name}\n### M1 — First · in progress\n`);
  return repo;
}

// A fake plugin cache: one folder per version, each with a bin/soloagile.
function cache(...versions) {
  const dir = tmp();
  for (const v of versions) {
    mkdirSync(join(dir, v, 'bin'), { recursive: true });
    writeFileSync(join(dir, v, 'bin', 'soloagile'), '');
  }
  return dir;
}

test('versions compare by number, not as text', () => {
  assert.ok(compareVersions('0.1.10', '0.1.9') > 0);
  assert.ok(compareVersions('0.1.9', '1.0.0') < 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
});

test('a newer version installed beside this one is found; an older or equal one is not', () => {
  const dir = cache('0.1.9', '0.1.10', '0.1.12', 'notes');
  assert.equal(newerInstall(join(dir, '0.1.10'), '0.1.10'), join(dir, '0.1.12', 'bin', 'soloagile'));
  assert.equal(newerInstall(join(dir, '0.1.12'), '0.1.12'), null);
});

test('a git checkout, whose folder is not a version, never hands off', () => {
  const dir = cache('9.9.9');
  mkdirSync(join(dir, 'soloagile'));
  assert.equal(newerInstall(join(dir, 'soloagile'), '0.1.0'), null);
});

test('an old copy hands the whole command to the newest one, stdin included', () => {
  const dir = tmp();
  cpSync(ROOT, join(dir, '0.1.1'), { recursive: true, filter: (f) => !/\/(\.git|pm|test)$/.test(f) });
  writeFileSync(join(dir, '0.1.1', 'package.json'), JSON.stringify({ version: '0.1.1', type: 'module' }));
  // The newer copy only says it was called, and echoes what came on stdin.
  mkdirSync(join(dir, '0.1.2', 'bin'), { recursive: true });
  const fake = join(dir, '0.1.2', 'bin', 'soloagile');
  writeFileSync(fake, `#!/usr/bin/env node\nconst i = require('fs').readFileSync(0, 'utf8');\nconsole.log('newer ' + process.argv.slice(2).join(' ') + ' ' + i);\n`);
  chmodSync(fake, 0o755);
  const r = spawnSync(join(dir, '0.1.1', 'bin', 'soloagile'), ['hook'], { encoding: 'utf8', input: '{"cwd":"/"}' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'newer hook {"cwd":"/"}');
});

test('a page says which version built it', () => {
  const repo = pmProject();
  const { out } = buildProject(repo);
  assert.equal(builtBy(out), VERSION);
});

test('a session start rebuilds a page an older version built, and leaves a current one alone', () => {
  const repo = pmProject();
  const page = join(repo, 'pm', 'index.html');
  writeFileSync(page, '<html><meta name="generator" content="soloagile 0.0.1"></html>');
  assert.equal(refreshOldPage(repo), true);
  assert.equal(builtBy(page), VERSION);
  assert.equal(refreshOldPage(repo), false);
  // A page from before versions were written down counts as old.
  writeFileSync(page, '<html>old</html>');
  assert.equal(refreshOldPage(repo), true);
});

test('build-all rebuilds every project in the projects folder, then the home page', () => {
  const a = pmProject(SERVED_FOLDER, 'one');
  const b = pmProject(SERVED_FOLDER, 'two');
  mkdirSync(join(SERVED_FOLDER, 'not-a-project'));
  buildProject(a);
  // An old page, older than its Markdown or not, is rebuilt all the same.
  writeFileSync(join(a, 'pm', 'index.html'), 'old');
  utimesSync(join(a, 'pm', 'index.html'), new Date(), new Date(Date.now() + 60000));
  const r = spawnSync(PM, ['build-all'], { encoding: 'utf8', cwd: a });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /rebuilt 2 pages/);
  for (const repo of [a, b]) assert.equal(builtBy(join(repo, 'pm', 'index.html')), VERSION);
  assert.ok(!existsSync(join(SERVED_FOLDER, 'not-a-project', 'pm')));
  assert.match(readFileSync(join(process.env.SOLOAGILE_DIR, 'home.html'), 'utf8'), /one/);
});
