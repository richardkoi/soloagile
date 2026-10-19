import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS, isLater, parseBoard, parseCardLine, parsePlan, stageOf } from '../src/board.js';

const BOARD = `# Board
<!-- next-id: 15 -->

## Ideas
- #14 Dark-mode toggle · M2

## Up next
- #9 Parse board.md · M1 · 3 pts
  done when: node --test passes
  second detail line

## Doing

## Needs your look
- #7 Light/dark page · M1 · built 2026-10-01

## Needs your decision
- #11 Show dates on cards? · M1 · asked 2026-10-01
  a) every card  b) only in Done

## Done
- #6 Folder convention agreed · M0 · 2026-09-30
`;

test('reads all six columns in order, empty ones included', () => {
  const { columns, nextId, problems } = parseBoard(BOARD);
  assert.deepEqual(columns.map((c) => c.name), COLUMNS);
  assert.deepEqual(columns.map((c) => c.cards.length), [1, 1, 0, 1, 1, 1]);
  assert.equal(nextId, 15);
  assert.deepEqual(problems, []);
});

test('reads id, title, milestone, dated state and detail lines', () => {
  const [, upNext, , look, decision, done] = parseBoard(BOARD).columns;
  assert.deepEqual(upNext.cards[0], {
    id: 9,
    title: 'Parse board.md',
    milestone: 'M1',
    points: 3,
    stage: null,
    date: null,
    details: ['done when: node --test passes', 'second detail line'],
  });
  assert.deepEqual(look.cards[0].date, { label: 'built', value: '2026-10-01' });
  assert.deepEqual(decision.cards[0].details, ['a) every card  b) only in Done']);
  assert.deepEqual(done.cards[0].date, { label: null, value: '2026-09-30' });
});

test('every card needs a milestone, an idea too', () => {
  const idea = parseBoard(BOARD).columns[0].cards[0];
  assert.equal(idea.milestone, 'M2');
  assert.equal(idea.title, 'Dark-mode toggle');
  const { problems } = parseBoard(BOARD.replace('Dark-mode toggle · M2', 'Dark-mode toggle'));
  assert.deepEqual(problems, ['board.md: card #14 has no milestone: give it the closest one in plan.md, or add a milestone for it']);
});

test('a title may contain the · separator', () => {
  const c = parseCardLine('#3 Plan · spec split · M0 · 2026-09-30');
  assert.equal(c.title, 'Plan · spec split');
  assert.equal(c.milestone, 'M0');
  assert.equal(c.date.value, '2026-09-30');
});

test('reads story points, wherever they sit among the milestone and date', () => {
  const c = parseCardLine('#7 Light/dark page · M1 · 5 pts · live 2026-10-01');
  assert.equal(c.title, 'Light/dark page');
  assert.equal(c.milestone, 'M1');
  assert.equal(c.points, 5);
  assert.equal(c.date.value, '2026-10-01');
  assert.equal(parseCardLine('#14 Dark-mode toggle · 1 pt').points, 1);
  assert.equal(parseCardLine('#8 Template · 2 pts · M1').milestone, 'M1');
  assert.equal(parseCardLine('#6 Folder convention agreed · M0').points, null);
});

test('points off the scale are reported', () => {
  const { problems } = parseBoard(BOARD.replace('3 pts', '4 pts'));
  assert.deepEqual(problems, ['board.md: card #9 has 4 pts; use 1, 2, 3, 5, 8 or 13']);
});

test('a Doing card carries its stage; every other lane implies one', () => {
  const doing = parseCardLine('#8 Write the template · M1 · 5 pts · test');
  assert.equal(doing.stage, 'test');
  assert.equal(doing.title, 'Write the template');
  assert.equal(doing.points, 5);
  assert.equal(stageOf(doing, 'Doing'), 'test');
  const plain = parseCardLine('#9 Parse board.md · M1 · 3 pts');
  assert.equal(plain.stage, null);
  assert.equal(stageOf(plain, 'Ideas'), 'plan');
  assert.equal(stageOf(plain, 'Up next'), 'plan');
  assert.equal(stageOf(plain, 'Doing'), 'develop', 'a Doing card with no stage written is being built');
  assert.equal(stageOf(plain, 'Needs your look'), 'feedback');
  assert.equal(stageOf(plain, 'Needs your decision'), null, 'a question has no stage');
  assert.equal(stageOf(plain, 'Done'), null, 'a finished card has left the wheel');
  const design = parseCardLine('#10 Stage strip · M1 · 5 pts · design · asked 2026-10-02');
  assert.equal(stageOf(design, 'Needs your decision'), 'design', 'a design waiting for his yes');
});

test('a stage written outside Doing, or one Doing never has, is reported', () => {
  const queued = parseBoard(BOARD.replace('· M1 · 3 pts', '· M1 · 3 pts · test')).problems;
  assert.deepEqual(queued, ['board.md: card #9 is marked "test"; only a Doing card carries a stage: design, develop, test or release']);
  const doing = (stage) => parseBoard(BOARD.replace('## Doing\n', `## Doing\n- #12 Build it · M1 · ${stage}\n`)).problems;
  assert.deepEqual(doing('release'), []);
  const waiting = parseBoard(BOARD.replace('#11 Show dates on cards? · M1', '#11 Show dates on cards? · M1 · design')).problems;
  assert.deepEqual(waiting, [], 'a design may wait in Needs your decision');
  assert.deepEqual(doing('feedback'), ['board.md: card #12 is marked "feedback"; only a Doing card carries a stage: design, develop, test or release']);
});

test("a look dated from a later day can't happen yet", () => {
  const look = parseCardLine('#4 Space station pass · M4 · 3 pts · from 2026-10-02');
  assert.deepEqual(look.date, { label: 'from', value: '2026-10-02' });
  assert.equal(isLater(look, 'Needs your look', '2026-10-01'), true);
  assert.equal(isLater(look, 'Needs your look', '2026-10-02'), false, 'on the day, it waits on the user');
  assert.equal(isLater(look, 'Done', '2026-10-01'), false, 'only looks can be for later');
  assert.equal(isLater(parseCardLine('#7 Page · M1 · live 2026-10-05'), 'Needs your look', '2026-10-01'), false);
});

test('a look with no tested: line is reported, unless it went live before the check began', () => {
  const look = (line, detail = '') =>
    parseBoard(`# Board\n<!-- next-id: 9 -->\n## Ideas\n## Up next\n## Doing\n## Needs your look\n- #1 Check it · M1${line}\n${detail}## Needs your decision\n## Done\n`).problems;
  assert.deepEqual(look(' · live 2026-10-03'), ['board.md: card #1 waits for the user\'s look with no "tested:" line; add one saying what was checked']);
  assert.equal(look('').length, 1, 'a look with no date is checked too');
  assert.deepEqual(look(' · live 2026-10-03', '  the short line\n  tested: 12 checks pass\n'), []);
  assert.deepEqual(look(' · from 2026-11-01', '  tested: 12 checks pass; the real pass is still to come\n'), []);
  assert.deepEqual(look(' · live 2026-10-02'), [], 'it reached the user before the check existed');
});

test('reports format slips instead of throwing', () => {
  const bad = `# Board
<!-- next-id: 3 -->
## Ideas
## Doing
- #3 Oops · 2026-09-30
- #3 Twice · M1
- no id here · M1
`;
  const { problems } = parseBoard(bad);
  assert.ok(problems.some((p) => p.includes('columns must be exactly')));
  assert.ok(problems.some((p) => p.includes('#3 appears more than once')));
  assert.ok(problems.some((p) => p.includes('#3 has no milestone')));
  assert.ok(problems.some((p) => p.includes('"no id here" has no #id')));
  assert.ok(problems.some((p) => p.includes('next-id 3 must be above')));
});

test('missing next-id is reported', () => {
  const { problems } = parseBoard(BOARD.replace('<!-- next-id: 15 -->', ''));
  assert.ok(problems.some((p) => p.includes('missing <!-- next-id')));
});

test('reads milestones and their status from plan.md', () => {
  const { milestones, problems } = parsePlan(`# Plan
## Milestones
### M0 — Convention, and this project's own board · done 2026-09-30
Done when: ...
### M1 — The page · in progress
short: First page
### M2 — Live updates · not started
`);
  assert.deepEqual(problems, []);
  assert.deepEqual(milestones, [
    { id: 'M0', title: "Convention, and this project's own board", status: 'done', date: '2026-09-30', short: null },
    { id: 'M1', title: 'The page', status: 'in progress', date: null, short: 'First page' },
    { id: 'M2', title: 'Live updates', status: 'not started', date: null, short: null },
  ]);
});

test('an unreadable milestone heading is reported', () => {
  const { problems } = parsePlan('### M3 — Phone view · someday\n');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /not understood/);
});
