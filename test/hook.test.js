import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';
import { isStale, projectsFor, runHook } from '../src/hook.js';

const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'soloagile');
const BOARD = `# Board
<!-- next-id: 2 -->
## Ideas
## Up next
- #1 A card · M1
## Doing
## Needs your look
## Needs your decision
## Done
`;

// A throwaway project with a pm/board.md, and optionally a page built at a set time.
function project({ board = BOARD, pageAge } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'pm-hook-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), board);
  if (pageAge !== undefined) {
    const page = join(repo, 'pm', 'index.html');
    writeFileSync(page, 'old page');
    const t = Date.now() / 1000 + pageAge;
    utimesSync(page, t, t);
  }
  return repo;
}

function runPm(payload) {
  return spawnSync(PM, ['hook'], { input: payload, encoding: 'utf8' });
}

test('a page older than its Markdown is out of date; a newer one is not', () => {
  assert.equal(isStale(project({ pageAge: -60 })), true);
  assert.equal(isStale(project({ pageAge: +60 })), false);
  assert.equal(isStale(project()), true, 'no page yet');
});

test('the edited pm/*.md names its project, even outside the session folder', () => {
  const repo = project();
  const payload = { cwd: tmpdir(), tool_input: { file_path: join(repo, 'pm', 'board.md') } };
  assert.deepEqual(projectsFor(payload), [repo]);
});

test('a Bash call has no file, so the session folder is checked', () => {
  const repo = project();
  assert.deepEqual(projectsFor({ cwd: repo, tool_input: { command: "sed -i 's/a/b/' pm/board.md" } }), [repo]);
});

test('folders without our pm/ files are skipped', () => {
  const plain = mkdtempSync(join(tmpdir(), 'pm-hook-'));
  const other = mkdtempSync(join(tmpdir(), 'pm-hook-'));
  mkdirSync(join(other, 'pm'));
  writeFileSync(join(other, 'pm', 'notes.md'), 'someone else\'s pm/ folder');
  assert.deepEqual(projectsFor({ cwd: plain }), []);
  assert.deepEqual(projectsFor({ cwd: other, tool_input: { file_path: join(other, 'pm', 'notes.md') } }), []);
});

test('runHook rebuilds only out-of-date pages', () => {
  const stale = project({ pageAge: -60 });
  const fresh = project({ pageAge: +60 });
  assert.deepEqual(runHook({ cwd: stale }).built, [join(stale, 'pm', 'index.html')]);
  assert.deepEqual(runHook({ cwd: fresh }).built, []);
  assert.ok(statSync(join(stale, 'pm', 'index.html')).size > 1000, 'a real page replaced the stub');
});

test('soloagile hook: a clean rebuild exits 0 and says nothing', () => {
  const repo = project();
  const r = runPm(JSON.stringify({ cwd: repo, tool_input: {} }));
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.ok(existsSync(join(repo, 'pm', 'index.html')));
});

test('soloagile hook: format warnings go to Claude with exit 2', () => {
  const repo = project({ board: BOARD.replace('- #1 A card · M1', '- A card with no id · M1') });
  const r = runPm(JSON.stringify({ cwd: repo }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /has no #id/);
  assert.ok(existsSync(join(repo, 'pm', 'index.html')), 'the page is still written');
});

test('soloagile hook: bad input never breaks the session', () => {
  assert.equal(runPm('not json').status, 0);
  assert.equal(runPm('').status, 0);
});
