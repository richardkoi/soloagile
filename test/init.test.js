import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SERVED_FOLDER } from './isolate.js';
import { initProject } from '../src/init.js';

const FILES = ['board.md', 'decisions.md', 'links.md', 'overview.md', 'plan.md', 'releases.md'];

function snapshot(repo) {
  const read = (p) => (existsSync(join(repo, p)) ? readFileSync(join(repo, p), 'utf8') : null);
  return Object.fromEntries(['.gitignore', '.dockerignore', ...FILES.map((f) => `pm/${f}`)].map((p) => [p, read(p)]));
}

test('a new project gets all six pm/ files, and its page builds cleanly', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pm-init-'));
  const { created, out, problems } = initProject(repo, '2026-10-01');
  // history.md is the seventh: the first build starts the log of card moves.
  assert.deepEqual(readdirSync(join(repo, 'pm')).filter((f) => f.endsWith('.md')).sort(), [...FILES, 'history.md'].sort());
  assert.ok(created.includes('pm/board.md'));
  assert.deepEqual(problems, []);
  assert.ok(existsSync(out));
  const plan = readFileSync(join(repo, 'pm', 'plan.md'), 'utf8');
  assert.match(plan, /^# pm-init-\w+\n/, 'the plan is titled with the folder name');
});

test('pm/ is kept out of Docker images and the page out of git, once each', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pm-init-'));
  writeFileSync(join(repo, '.gitignore'), 'node_modules/');
  initProject(repo, '2026-10-01');
  initProject(repo, '2026-10-01');
  assert.equal(readFileSync(join(repo, '.gitignore'), 'utf8'), 'node_modules/\npm/index.html\n');
  assert.equal(readFileSync(join(repo, '.dockerignore'), 'utf8'), 'pm/\n');
});

test('it never overwrites, and a second run changes nothing', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pm-init-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'plan.md'), '# Mine\n');
  initProject(repo, '2026-10-01');
  assert.equal(readFileSync(join(repo, 'pm', 'plan.md'), 'utf8'), '# Mine\n');
  const before = snapshot(repo);
  const { created } = initProject(repo, '2026-10-02');
  assert.deepEqual(created, []);
  assert.deepEqual(snapshot(repo), before);
});

test('links.md lists the page only where a page server serves it', () => {
  const links = (repo) => (initProject(repo, '2026-10-01'), readFileSync(join(repo, 'pm', 'links.md'), 'utf8'));
  // The tests' settings name a page server and its projects folder (test/isolate.js).
  const served = links(join(SERVED_FOLDER, 'alpha'));
  assert.match(served, /^## This page\n- \[Project page\]\(http:\/\/pages\.test\/alpha\/\) · added 2026-10-01\n/m);
  assert.doesNotMatch(served, /second address|\{\{/, 'no second address is set, so its line is dropped');
  const elsewhere = links(mkdtempSync(join(tmpdir(), 'pm-init-')));
  assert.doesNotMatch(elsewhere, /This page|pages\.test|\{\{/, 'a page that is a file on this machine is not listed');
});
