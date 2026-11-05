import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVED_FOLDER } from './isolate.js';
import { boardJson } from '../src/json.js';

const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'soloagile');
const TODAY = '2026-11-05';

const BOARD = `# Board
<!-- next-id: 20 -->

## Ideas
- #12 Later idea · M3 · 1 pt

## Up next
- #9 Parse board.md · M2 · 3 pts · ~7 min
  done when: node --test passes
- #10 On the laptop · M2 · 1 pt
  not before: the next time Rich uses the laptop

## Doing
- #8 Build it · M2 · 2 pts · test

## Needs your look
- #7 Light/dark page · M2 · 1 pt · live 2026-11-04
  tested: shots at 360px
- #11 A pass overhead · M2 · 1 pt · from 2026-12-01

## Needs your decision
- #13 Which one? · M2 · asked 2026-11-04
  a) this  b) that

## Done
- #6 Folder convention · M2 · 1 pt · 2026-11-03
- #5 Old thing · M1 · 1 pt · 2026-11-03
`;

const PLAN = `# Alpha

### M1 — Start · done 2026-11-03
short: The start

### M2 — The page · in progress
short: Page

### M3 — Later · not started
`;

const ARCHIVE = `# Finished cards

- #4 Earlier page work · M2 · 2 pts · 2026-10-30
  tested: ran it
- #3 First · M1 · 1 pt · 2026-10-29
`;

const json = () => boardJson({ boardMd: BOARD, planMd: PLAN, archiveMd: ARCHIVE, name: 'Alpha', today: TODAY, page: 'http://pages.test/alpha/' });

test('board json: project, page, counts and the next move', () => {
  const j = json();
  assert.equal(j.format, 1);
  assert.equal(j.project, 'Alpha');
  assert.equal(j.page, 'http://pages.test/alpha/');
  // The look dated "from" a later day waits on no one yet.
  assert.deepEqual(j.counts, { decisions: 1, looks: 1, waiting: 2, doing: 1, upNext: 2, ideas: 1, done: 2 });
  assert.equal(j.next, 'ask the user about #13 (/soloagile:needs)');
});

test('board json: every open lane with its cards in full, and no Done lane', () => {
  const j = json();
  assert.deepEqual(j.lanes.map((l) => l.name), ['Ideas', 'Up next', 'Doing', 'Needs your look', 'Needs your decision']);
  const upNext = j.lanes[1].cards;
  assert.deepEqual(upNext[0], {
    id: 9, title: 'Parse board.md', milestone: 'M2', points: 3, guess: 7, stage: 'plan',
    date: null, details: ['done when: node --test passes'], waits: null, later: false,
  });
  assert.equal(upNext[1].waits, 'the next time Rich uses the laptop');
  const doing = j.lanes[2].cards[0];
  assert.equal(doing.stage, 'test');
  const looks = j.lanes[3].cards;
  assert.deepEqual(looks.map((c) => [c.id, c.later]), [[7, false], [11, true]]);
  assert.deepEqual(looks[0].date, { label: 'live', value: '2026-11-04' });
});

test('board json: progress for each milestone with an open card, finished cards counted from the archive too', () => {
  const j = json();
  assert.deepEqual(j.milestones, [
    { id: 'M2', title: 'The page', short: 'Page', status: 'in progress', done: 2, total: 8 },
    { id: 'M3', title: 'Later', short: null, status: 'not started', done: 0, total: 1 },
  ]);
});

test('soloagile board --json prints it for a project, and plain board is unchanged', () => {
  const repo = mkdtempSync(join(SERVED_FOLDER, 'json-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), BOARD);
  writeFileSync(join(repo, 'pm', 'plan.md'), PLAN);
  writeFileSync(join(repo, 'pm', 'finished-cards.md'), ARCHIVE);
  const r = spawnSync(process.execPath, [PM, 'board', '--json', repo], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.project, 'Alpha');
  assert.match(j.page, /^http:\/\/pages\.test\/json-/);
  assert.equal(j.counts.waiting, 2);
  const flagLast = spawnSync(process.execPath, [PM, 'board', repo, '--json'], { cwd: repo, encoding: 'utf8' });
  assert.equal(JSON.parse(flagLast.stdout).project, 'Alpha');
  const plain = spawnSync(process.execPath, [PM, 'board', repo], { encoding: 'utf8' });
  assert.match(plain.stdout, /^## Done\n2 finished cards/m);
});

test('soloagile board --json with no board fails with a message', () => {
  const repo = mkdtempSync(join(tmpdir(), 'json-none-'));
  const r = spawnSync(process.execPath, [PM, 'board', '--json', repo], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no pm\/board\.md/);
});
