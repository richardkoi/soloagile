import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';
import { parseBoard } from '../src/board.js';
import { Refused, addDecision, runCard } from '../src/card.js';

const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'soloagile');
const PLAN = '# Demo\n## Milestones\n### M1 — Start · done 2026-10-01\n### M2 — Now · in progress\n';
const BOARD = `# Board
<!-- next-id: 9 -->

## Ideas
- #3 An idea with no milestone · 2 pts

## Up next
- #8 Queued · M2 · 2 pts
  done when: it is done

## Doing
- #7 In hand · M2 · 3 pts · develop
  the short line

## Needs your look

## Needs your decision

## Done
- #6 Finished · M2 · 1 pt · 2026-10-13
`;
const ARCHIVE = '# Finished cards, in full\n\n- #6 Finished · M2 · 1 pt · 2026-10-13\n  what was built\n  tested: 4 pass\n- #2 Long gone · M1 · 2026-10-01\n';
const today = '2026-10-13';
const run = (words, board = BOARD) => runCard(words, { board, plan: PLAN, archive: ARCHIVE, today });
const refused = (words, why, board = BOARD) => assert.throws(() => run(words, board), (e) => e instanceof Refused && why.test(e.message), words.join(' '));
const lane = (board, name) => parseBoard(board).columns.find((c) => c.name === name).cards;

test('add: a new card gets the next number, its milestone, points and finish line, in Up next', () => {
  const r = run(['add', 'Night vision mode', '--milestone', 'M2', '--points', '3', '--done-when', 'seen at night', '--note', 'asked today']);
  assert.equal(r.said, 'added #9 to Up next');
  assert.ok(r.board.includes('<!-- next-id: 10 -->'));
  assert.ok(r.board.includes('  done when: it is done\n- #9 Night vision mode · M2 · 3 pts\n  asked today\n  done when: seen at night\n\n## Doing'));
  assert.deepEqual(parseBoard(r.board).problems.filter((p) => !p.includes('#3')), []);
});

test('add: other lanes; an idea needs no finish line, a question has options and no points', () => {
  assert.equal(lane(run(['add', 'Maybe later', '-m', 'M2', '-p', '5', '--lane', 'ideas']).board, 'Ideas').at(-1).id, 9);
  assert.ok(run(['add', 'Start now', '-m', 'M2', '-p', '1', '--lane', 'doing', '--done-when', 'x']).board.includes('- #9 Start now · M2 · 1 pt · develop\n'));
  const q = run(['add', 'Which colour?', '-m', 'M2', '--lane', 'decision', '--option', 'Green (recommended)', '--option', 'Something else: tell Claude']).board;
  assert.ok(q.includes('- #9 Which colour? · M2 · asked 2026-10-13\n  a) Green (recommended)\n  b) Something else: tell Claude\n'));
  const d = run(['add', 'Stage strip', '-m', 'M2', '-p', '5', '--lane', 'decision', '--design', '--option', 'A', '--option', 'B']).board;
  assert.ok(d.includes('- #9 Stage strip · M2 · 5 pts · design · asked 2026-10-13\n'));
});

test('add: a card that would be wrong is refused, with what to do', () => {
  refused(['add', 'No milestone', '--points', '3'], /needs a milestone: --milestone M3/);
  refused(['add', 'Unknown milestone', '-m', 'M9', '-p', '3'], /pm\/plan\.md has no M9 \(it has M1, M2\); add the milestone there first/);
  refused(['add', 'No points', '-m', 'M2'], /needs story points: --points 1, 2, 3, 5, 8 or 13/);
  refused(['add', 'Odd points', '-m', 'M2', '-p', '4', '--done-when', 'x'], /needs story points/);
  refused(['add', 'No finish line', '-m', 'M2', '-p', '3'], /needs its finish line: --done-when/);
  refused(['add', 'A question?', '-m', 'M2', '--lane', 'decision'], /needs its options/);
  refused(['add', 'Built already', '-m', 'M2', '-p', '1', '--lane', 'look'], /can't start in Needs your look/);
  refused(['add', '', '-m', 'M2', '-p', '1'], /needs a title/);
});

test('add: the number is above every card, even when next-id was left behind', () => {
  assert.equal(run(['add', 'X', '-m', 'M2', '-p', '1', '--lane', 'ideas'], BOARD.replace('next-id: 9', 'next-id: 4')).id, 9);
});

test('move: through the lanes, with the stage and the date each one carries', () => {
  let b = run(['move', '8', 'doing']).board;
  assert.ok(b.includes('- #8 Queued · M2 · 2 pts · develop\n  done when: it is done\n\n## Needs your look'), 'it goes to the foot of Doing, with its lines');
  assert.ok(!b.includes('## Up next\n- #8'));
  b = run(['move', '8', 'doing', 'test'], b).board;
  assert.ok(b.includes('- #8 Queued · M2 · 2 pts · test\n'));
  b = run(['note', '8', 'tested: 12 pass'], b).board;
  const look = run(['move', '#8', 'look'], b);
  assert.equal(look.said, '#8 is in Needs your look, live 2026-10-13');
  assert.ok(look.board.includes('## Needs your look\n- #8 Queued · M2 · 2 pts · live 2026-10-13\n  done when: it is done\n  tested: 12 pass\n'));
  assert.ok(run(['move', '8', 'look', '--from', '2026-10-20'], b).board.includes('- #8 Queued · M2 · 2 pts · from 2026-10-20\n'));
  const done = run(['move', '8', 'done'], look.board);
  assert.equal(done.column, 'Done');
  assert.ok(done.board.includes('- #8 Queued · M2 · 2 pts · 2026-10-13\n'));
  assert.deepEqual(parseBoard(look.board).problems.filter((p) => !p.includes('#3')), []);
});

test('move: a wrong move is refused and says why', () => {
  refused(['move', '7', 'look'], /#7 has no "tested:" line; say what was checked first: soloagile card note 7 "tested: …"/);
  refused(['move', '3', 'next'], /#3 has no milestone; give it the closest one in pm\/plan\.md: soloagile card set 3 --milestone M3/);
  refused(['move', '7', 'decision'], /#7 has no options to choose from/);
  refused(['move', '7', 'doing', 'testing'], /"testing" is not a stage; use design, develop, test or release/);
  refused(['move', '7', 'next', 'test'], /only a Doing card has a stage/);
  refused(['move', '7', 'waiting'], /there is no "waiting" lane; use ideas, next, doing, look, decision or done/);
  refused(['move', '7'], /say which lane/);
  refused(['move', '99', 'doing'], /there is no card #99 on the board/);
  refused(['move', '2', 'doing'], /#2 is finished and off the board; `soloagile finished 2` prints it/);
  refused(['move', 'seven', 'doing'], /"seven" is not a card number/);
  refused(['move', '8', 'next'], /has no story points/, BOARD.replace('- #8 Queued · M2 · 2 pts', '- #8 Queued · M2'));
});

test('move: a design goes to decision with its options, and a finished card comes back with its text', () => {
  let b = run(['note', '7', 'a) Tabs (recommended)'], BOARD).board;
  b = run(['note', '7', 'b) Something else: tell Claude'], b).board;
  assert.ok(run(['move', '7', 'decision', '--design'], b).board.includes('- #7 In hand · M2 · 3 pts · design · asked 2026-10-13\n  the short line\n  a) Tabs (recommended)\n'));
  const back = run(['move', '6', 'doing']).board;
  assert.ok(back.includes('- #6 Finished · M2 · 1 pt · develop\n  what was built\n  tested: 4 pass\n'));
});

test('note, set and show', () => {
  assert.ok(run(['note', '7', 'fix: the label is cut off', '--first']).board.includes('- #7 In hand · M2 · 3 pts · develop\n  fix: the label is cut off\n  the short line\n'));
  refused(['note', '7'], /say what to note/);
  const set = run(['set', '3', '--milestone', 'M2', '--points', '5', '--title', 'An idea, placed']);
  assert.ok(set.board.includes('- #3 An idea, placed · M2 · 5 pts\n'));
  assert.deepEqual(parseBoard(set.board).problems, []);
  refused(['set', '3'], /say what to set/);
  refused(['set', '3', '--milestone', 'M7'], /pm\/plan\.md has no M7/);
  assert.equal(run(['show', '7']).print, 'Doing\n- #7 In hand · M2 · 3 pts · develop\n  the short line\n');
  assert.equal(run(['show', '6']).print, 'Done\n- #6 Finished · M2 · 1 pt · 2026-10-13\n  what was built\n  tested: 4 pass\n');
  refused(['show', '99'], /there is no card #99/);
  refused(['bump', '7'], /there is no "card bump"/);
  refused(['move', '7', 'doing', '--stage', 'test'], /there is no --stage here/);
});

test('choose: the options become one "chosen" line, and a wrong pick is refused', () => {
  const q = run(['add', 'Which colour?', '-m', 'M2', '--lane', 'decision', '--note', 'for the header', '--option', 'Green (recommended)', '--option', 'Blue', '--option', 'Something else: tell Claude']).board;
  const r = run(['choose', '9', 'b'], q);
  assert.equal(r.said, '#9: chosen b) Blue');
  assert.equal(r.column, 'Needs your decision', 'it stays in its lane');
  assert.ok(r.board.includes('- #9 Which colour? · M2 · asked 2026-10-13\n  for the header\n  chosen 2026-10-13: b) Blue\n\n## Done'));
  assert.ok(!r.board.includes('a) Green'));
  assert.ok(run(['choose', '9', 'C)'], q).board.includes('  chosen 2026-10-13: c) Something else: tell Claude\n'));
  refused(['choose', '9', 'd'], /"d" is not one of #9's options; it has a, b or c: soloagile card choose 9 a/, q);
  refused(['choose', '9'], /say which option; it has a, b or c/, q);
  refused(['choose', '7', 'a'], /#7 has no options to choose from/);
  refused(['choose', '99', 'a'], /there is no card #99 on the board/);
});

test('the command writes the board and the page, archives a finished card, and writes nothing when it refuses', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pm-card-'));
  mkdirSync(join(repo, 'pm'));
  const d = new Date();
  const now = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  writeFileSync(join(repo, 'pm', 'board.md'), BOARD.replace('- #3 An idea with no milestone · 2 pts', '- #3 An idea · M2 · 2 pts').replaceAll('2026-10-13', now));
  writeFileSync(join(repo, 'pm', 'plan.md'), PLAN);
  const card = (...args) => spawnSync(PM, ['card', ...args], { cwd: repo, encoding: 'utf8' });
  const board = () => readFileSync(join(repo, 'pm', 'board.md'), 'utf8');

  const before = board();
  const no = card('move', '7', 'look');
  assert.equal(no.status, 1);
  assert.match(no.stderr, /^soloagile: refused: #7 has no "tested:" line/);
  assert.equal(board(), before);

  const add = card('add', 'A new one', '--milestone', 'M2', '--points', '2', '--done-when', 'seen');
  assert.equal(add.status, 0, add.stderr);
  assert.match(add.stdout, /^soloagile: added #9 to Up next\n/);
  assert.equal(add.stderr, '', 'the board it leaves has nothing for the checker to say');
  assert.ok(readFileSync(join(repo, 'pm', 'index.html'), 'utf8').includes('A new one'));
  assert.match(readFileSync(join(repo, 'pm', 'history.md'), 'utf8'), /· Up next · #9 A new one · M2 · 2 pts/);

  card('note', '7', 'tested: 3 pass');
  card('move', '7', 'look');
  const done = card('move', '7', 'done');
  assert.match(done.stdout, /#7 is in Done\nsoloagile: 2 finished cards are in pm\/finished-cards\.md/, "#6 had no entry yet, so it is kept too");
  assert.ok(board().includes(`- #7 In hand · M2 · 3 pts · ${now}\n`));
  assert.ok(!board().includes('tested: 3 pass'));
  assert.ok(readFileSync(join(repo, 'pm', 'finished-cards.md'), 'utf8').includes('  the short line\n  tested: 3 pass\n'));
  assert.match(card('show', '7').stdout, /^Done\n- #7 .*\n  the short line\n  tested: 3 pass\n/);
  assert.match(card().stdout, /soloagile card add "<title>"/);
  assert.match(card().stdout, /soloagile card choose <number> <letter>/);
});

test('a card takes a guessed build time on add and set, written after its points', () => {
  const r = run(['add', 'Night vision mode', '--milestone', 'M2', '--points', '3', '--guess', '40', '--done-when', 'seen at night']);
  assert.ok(r.board.includes('- #9 Night vision mode · M2 · 3 pts · ~40 min\n'));
  assert.equal(lane(r.board, 'Up next').at(-1).guess, 40);
  const s = run(['set', '7', '--guess', '2.5h']);
  assert.ok(s.board.includes('- #7 In hand · M2 · 3 pts · ~2.5 h · develop\n'));
  assert.ok(run(['set', '7', '--guess', '90 min']).board.includes('- #7 In hand · M2 · 3 pts · ~90 min · develop\n'));
  refused(['set', '7', '--guess', 'soon'], /--guess takes a time/);
  refused(['add', 'Which way?', '--milestone', 'M2', '--lane', 'decision', '--option', 'a', '--option', 'b', '--guess', '20'], /a question has no size, so no guess/);
});

test('a milestone counts its cards on the board and finished, each once', async () => {
  const { milestoneCount } = await import('../src/card.js');
  const board = '# Board\n## Up next\n- #3 C · M2 · 1 pt\n- #4 D · M1 · 1 pt\n## Done\n- #1 A · M2 · 1 pt · 2026-10-01\n';
  const archive = '# Finished cards\n- #1 A · M2 · 1 pt · 2026-10-01\n  done when: x\n- #2 B · M2 · 2 pts · 2026-10-01\n';
  assert.equal(milestoneCount(board, archive, 'M2'), 3);
  assert.equal(milestoneCount(board, '', 'M1'), 1);
});

test('reword and unnote change or remove one detail line, found by how it starts', () => {
  const b = run(['note', '8', 'not before 2026-10-27'], BOARD).board;
  const r = run(['reword', '8', 'done when', 'done when: it is done, and tested'], b);
  assert.equal(r.said, '#8: reworded "done when: it is done, and tested"');
  assert.ok(r.board.includes('- #8 Queued · M2 · 2 pts\n  done when: it is done, and tested\n  not before 2026-10-27\n'));
  const u = run(['unnote', '8', 'NOT before'], b);
  assert.equal(u.said, '#8: removed "not before 2026-10-27"');
  assert.ok(u.board.includes('- #8 Queued · M2 · 2 pts\n  done when: it is done\n\n'));
  refused(['reword', '8', 'tested', 'tested: x'], /#8 has no detail line starting "tested"; its lines start: done when: it is done/);
  refused(['reword', '8', 'done when'], /say the new line/);
  refused(['unnote', '8'], /say how the line starts/);
  const two = run(['note', '8', 'done when: again'], BOARD).board;
  refused(['unnote', '8', 'done'], /2 of #8's lines start "done"; say more of it/, two);
  refused(['unnote', '99', 'x'], /there is no card #99 on the board/);
});

test('drop takes a card off the board, and its reason goes in the decisions', () => {
  const r = run(['drop', '8', 'folded into #7'], BOARD);
  assert.equal(r.said, '#8 is off the board: folded into #7');
  assert.ok(!/#8 /.test(r.board));
  assert.equal(r.decision, '## 2026-10-13 · #8 dropped: Queued\n**Why:** folded into #7\n**The card:** Queued · M2 · 2 pts\n  done when: it is done\n');
  refused(['drop', '8'], /say why: soloagile card drop 8 "…"/);
  refused(['drop', '99', 'x'], /there is no card #99 on the board/);
  const md = '# Decisions\n\nNewest first.\n\n## 2026-10-01 · Old\n**Answer:** yes\n';
  assert.equal(addDecision(md, '## new\n'), '# Decisions\n\nNewest first.\n\n## new\n\n## 2026-10-01 · Old\n**Answer:** yes\n');
  assert.equal(addDecision('', '## new\n'), '# Decisions\n\n## new\n');
});

test('soloagile card drop writes the decision into pm/decisions.md', () => {
  const repo = mkdtempSync(join(tmpdir(), 'soloagile-drop-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), BOARD);
  const r = spawnSync(PM, ['card', 'drop', '8', 'not needed'], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(repo, 'pm', 'decisions.md'), 'utf8'), /^## \d{4}-\d\d-\d\d · #8 dropped: Queued\n\*\*Why:\*\* not needed$/m);
});
