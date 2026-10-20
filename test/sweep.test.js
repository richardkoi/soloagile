// soloagile cleanup and backup (src/cleanup.js). The older test/cleanup.test.js is about
// the tests cleaning up after themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';
import { cleanupProject, weeklyCleanup } from '../src/cleanup.js';

const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'soloagile');
const NOW = new Date('2026-10-20T12:00:00');
const git = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
const aged = (path, daysAgo) => {
  const t = (NOW - daysAgo * 86400000) / 1000;
  utimesSync(path, t, t);
};

function project() {
  const repo = mkdtempSync(join(tmpdir(), 'soloagile-sweep-'));
  mkdirSync(join(repo, 'pm', 'designs'), { recursive: true });
  writeFileSync(join(repo, 'pm', 'board.md'), '# Board\n<!-- next-id: 9 -->\n## Ideas\n## Up next\n## Doing\n## Needs your look\n## Needs your decision\n## Done\n');
  writeFileSync(join(repo, 'pm', 'plan.md'), '# Alpha\n### M1 — First · in progress\nshort: First\n');
  writeFileSync(join(repo, 'pm', 'finished-cards.md'), '# Finished cards\n- #1 Old · M1 · 1 pt · 2026-10-01\n- #2 Recent · M1 · 1 pt · 2026-10-18\n');
  for (const id of [1, 2, 3]) mkdirSync(join(repo, 'pm', 'designs', `card-${id}`));
  return repo;
}

test("cleanup: old shots folders, and the picture pages of cards finished over a week ago; --dry-run only says", () => {
  const repo = project();
  const temp = mkdtempSync(join(tmpdir(), 'soloagile-temp-'));
  for (const [name, age] of [['pm-shots-old', 9], ['pm-shots-new', 1], ['other-old', 9]]) {
    mkdirSync(join(temp, name));
    aged(join(temp, name), age);
  }
  const dry = cleanupProject(repo, { now: NOW, temp, dry: true });
  assert.equal(dry.length, 2);
  assert.ok(existsSync(join(temp, 'pm-shots-old')), 'a dry run removes nothing');
  const said = cleanupProject(repo, { now: NOW, temp });
  assert.match(said.join('\n'), /removed an old shots folder: .*pm-shots-old/);
  assert.match(said.join('\n'), /removed #1's picture page, finished 2026-10-01/);
  assert.deepEqual(['pm-shots-old', 'pm-shots-new', 'other-old'].map((f) => existsSync(join(temp, f))), [false, true, true]);
  assert.deepEqual([1, 2, 3].map((id) => existsSync(join(repo, 'pm', 'designs', `card-${id}`))), [false, true, true], 'recent or unfinished cards keep theirs');
});

test('cleanup removes a helper worktree once its work is merged, and keeps a fresh one and one with work left', () => {
  const repo = project();
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'start');
  const tree = (name) => join(repo, '.claude', 'worktrees', name);
  git(repo, 'worktree', 'add', '-q', '-b', 'merged', tree('merged'));
  git(repo, 'worktree', 'add', '-q', '-b', 'busy', tree('busy'));
  git(repo, 'worktree', 'add', '-q', '-b', 'fresh', tree('fresh'));
  writeFileSync(join(tree('busy'), 'wip.txt'), 'not committed');
  writeFileSync(join(tree('merged'), 'done.txt'), 'the helper work');
  git(tree('merged'), 'add', '-A');
  git(tree('merged'), '-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'work');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge', 'merged');
  const said = cleanupProject(repo, { now: NOW, temp: join(repo, 'none') });
  assert.match(said.join('\n'), /removed a merged helper worktree: .*merged/);
  // A helper that has only just started has no commits of its own yet: it is not finished.
  assert.deepEqual(['merged', 'busy', 'fresh'].map((t) => existsSync(tree(t))), [false, true, true]);
});

test('the weekly run happens once a week per project', () => {
  const repo = project();
  assert.ok(Array.isArray(weeklyCleanup(repo, { now: NOW })));
  assert.equal(weeklyCleanup(repo, { now: new Date('2026-10-23T12:00:00') }), null, 'three days later: not yet');
  assert.ok(Array.isArray(weeklyCleanup(repo, { now: new Date('2026-10-28T12:00:00') })));
});

test('soloagile backup runs the command pm/settings.json names, or says there is none', () => {
  const repo = project();
  const run = () => spawnSync(PM, ['backup'], { cwd: repo, encoding: 'utf8' });
  assert.match(run().stdout, /no backup set/);
  writeFileSync(join(repo, 'pm', 'settings.json'), JSON.stringify({ backup: 'touch backed-up' }));
  assert.equal(run().status, 0);
  assert.ok(existsSync(join(repo, 'backed-up')));
  writeFileSync(join(repo, 'pm', 'settings.json'), JSON.stringify({ backup: 'exit 3' }));
  assert.equal(run().status, 3);
});
