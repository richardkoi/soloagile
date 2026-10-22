import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';
import { parseBoard } from '../src/board.js';
import { nextText } from '../src/next.js';

const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'soloagile');
const TODAY = '2026-10-22';
const next = (md) => nextText(parseBoard(md), { name: 'Alpha', today: TODAY });
const board = (lanes) => `# Board\n<!-- next-id: 99 -->\n## Ideas\n## Up next\n${lanes.next ?? ''}## Doing\n${lanes.doing ?? ''}## Needs your look\n${lanes.look ?? ''}## Needs your decision\n${lanes.decision ?? ''}## Done\n- #1 Old · M1 · 1 pt · done 2026-10-01\n`;

test('next: a waiting decision comes first, then a look', () => {
  const t = next(board({ decision: '- #6 Which one? · M1 · asked 2026-10-20\n  a) This\n', look: '- #4 Look at this · M1 · 1 pt · live 2026-10-20\n', next: '- #2 Next · M1 · 1 pt\n' }));
  assert.match(t, /^Alpha · 1 decision, 1 look, 0 doing, 1 up next$/m);
  assert.match(t, /Waiting on you:\n- #6 Which one\? \(decision\)\n- #4 Look at this \(look\)/);
  assert.match(t, /Next move: ask the user about #6 \(\/soloagile:needs\)$/);
  assert.match(next(board({ look: '- #4 Look at this · M1 · 1 pt · live 2026-10-20\n' })), /Next move: get the user's look on #4 \(\/soloagile:needs\)$/);
});

test('next: a Doing card is carried on before Up next starts, and a look for later waits on no one', () => {
  const t = next(board({ doing: '- #3 Current · M1 · 2 pts · test\n', look: '- #5 Pass · M1 · 1 pt · from 2026-11-01\n', next: '- #2 Next · M1 · 1 pt\n' }));
  assert.match(t, /^Alpha · 0 decisions, 0 looks, 1 doing, 1 up next$/m);
  assert.doesNotMatch(t, /Waiting on you/);
  assert.match(t, /Doing:\n- #3 Current \(test\)/);
  assert.match(t, /Next move: carry on with #3, at test$/);
});

test('next: Up next starts at the first card that can start, and a busy one shows its top 5', () => {
  const cards = [
    '- #10 After the week · M1 · 1 pt\n  not before 2026-10-27: the week has to pass\n',
    '- #11 On the laptop · M1 · 1 pt\n  not before: the next time Rich uses the laptop\n',
    '- #12 Was waiting, now free · M1 · 1 pt\n  not before 2026-10-20: done waiting\n',
    ...Array.from({ length: 8 }, (_, i) => `- #${20 + i} Card ${i} · M1 · 2 pts\n`),
  ].join('');
  const t = next(board({ next: cards }));
  assert.match(t, /Up next \(top 5 of 11\):\n- #10 After the week \(not before 2026-10-27\)\n- #11 On the laptop \(waits: the next time Rich uses the laptop\)\n- #12 Was waiting, now free\n- #20 Card 0\n- #21 Card 1\n/);
  assert.doesNotMatch(t, /#22/);
  assert.match(t, /Next move: start #12 Was waiting, now free$/);
});

test('next: nothing to start says when, and an empty board says to plan', () => {
  assert.match(next(board({ next: '- #10 Later · M1 · 1 pt\n  not before 2026-10-27: wait\n' })), /Next move: nothing can start until 2026-10-27; plan more in pm\/plan\.md$/);
  assert.match(next(board({})), /Next move: plan the next milestone in pm\/plan\.md$/);
});

test('soloagile next runs in a project, and says so without a board', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pm-next-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), board({ next: '- #2 Next · M1 · 1 pt\n' }));
  writeFileSync(join(repo, 'pm', 'plan.md'), '# Alpha Tool\n### M1 — First · in progress\n');
  const r = spawnSync(PM, ['next', repo], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Alpha Tool · 0 decisions/);
  assert.match(r.stdout, /Next move: start #2 Next\n$/);
  const none = spawnSync(PM, ['next', tmpdir()], { encoding: 'utf8' });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /no pm\/board\.md/);
});
