import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';

const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'soloagile');
const run = (...args) => spawnSync(PM, args, { encoding: 'utf8' });
const NAMES = ['build', 'init', 'home', 'build-all', 'card', 'archive', 'board', 'finished', 'set', 'sizes', 'link', 'shots', 'design'];

test('help, --help, -h and no command at all list every command, one to a line', () => {
  for (const args of [['help'], ['--help'], ['-h'], []]) {
    const r = run(...args);
    assert.equal(r.status, 0, args.join(' '));
    for (const name of NAMES) assert.match(r.stdout, new RegExp(`^  soloagile ${name}\\b.* {2}\\S`, 'm'), name);
  }
});

test('a command that does not exist is named, and the real ones are listed', () => {
  const r = run('page');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^soloagile: there is no "page" command\. The commands:\n/);
  for (const name of NAMES) assert.ok(r.stderr.includes(`  soloagile ${name}`), name);
});
