import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';
import { archiveBoard, archivedDetails, finishedCards, openBoard } from '../src/archive.js';
import { parseBoard } from '../src/board.js';
import { readTemplate } from '../src/build.js';
import { renderPage } from '../src/page.js';

const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'soloagile');
const BOARD = `# Board
<!-- next-id: 9 -->

## Ideas

## Up next
- #8 Still to do · M2 · 2 pts
  done when: it is done

## Doing

## Needs your look

## Needs your decision

## Done
- #7 Fresh, with its text · M2 · 3 pts · 2026-10-13
  the short line
  tested: 12 pass
- #6 Fresh, already short · M2 · 1 pt · 2026-10-12
- #5 Old, with its text · M1 · 2 pts · 2026-10-09
  what was built
- #4 No date · M1
`;
const TODAY = '2026-10-13';

test('a finished card keeps one line on the board; its text goes to the archive, newest first', () => {
  const { board, archive, moved, left } = archiveBoard(BOARD, '', TODAY);
  const done = parseBoard(board).columns.at(-1).cards;
  assert.deepEqual(done.map((c) => [c.id, c.details.length]), [[7, 0], [6, 0], [4, 0]]);
  assert.deepEqual(moved, [7, 6, 5, 4]);
  assert.deepEqual(left, [5], 'a card past its 48 hours leaves the board');
  assert.match(archive, /^# Finished cards, in full\n/);
  assert.ok(archive.includes('- #7 Fresh, with its text · M2 · 3 pts · 2026-10-13\n  the short line\n  tested: 12 pass\n'));
  assert.ok(archive.indexOf('- #7 ') < archive.indexOf('- #5 '));
  assert.ok(board.includes('- #8 Still to do · M2 · 2 pts\n  done when: it is done\n'), 'open cards are left alone');
  assert.deepEqual(parseBoard(board).problems, []);
});

test('archiving twice changes nothing, and a short Done line never wipes the kept text', () => {
  const once = archiveBoard(BOARD, '', TODAY);
  const twice = archiveBoard(once.board, once.archive, TODAY);
  assert.equal(twice.board, once.board);
  assert.equal(twice.archive, once.archive);
  assert.deepEqual(twice.moved, []);
});

test('a card finished again keeps its old lines and gains the new, and an archive made by hand is kept', () => {
  const old = '# Finished cards, in full\n\n- #7 Fresh, with its text · M2 · 3 pts · 2026-10-01\n  the first try\n- #2 From before · M1 · 2026-09-30\n  kept\n';
  const { archive } = archiveBoard(BOARD, old, TODAY);
  assert.equal(archive.match(/^- #7 /gm).length, 1);
  assert.ok(archive.includes('- #7 Fresh, with its text · M2 · 3 pts · 2026-10-13\n  the first try\n  the short line\n  tested: 12 pass\n'));
  assert.ok(archive.includes('- #2 From before · M1 · 2026-09-30\n  kept\n'));
});

test('the checker says when Done cards still carry their text', () => {
  const { problems } = parseBoard(BOARD);
  assert.deepEqual(problems, ['board.md: 2 Done cards still carry their full text; run `soloagile archive` to move it to pm/finished-cards.md']);
});

test('the page opens a finished card in full, from the archive', () => {
  const { board, archive } = archiveBoard(BOARD, '', TODAY);
  assert.deepEqual(archivedDetails(archive).get(7), ['the short line', 'tested: 12 pass']);
  const md = { board, plan: '', releases: '', overview: '', decisions: '', links: '', finished: archive };
  const { html } = renderPage({ name: 'x', md, builtAt: new Date(2026, 9, 13, 12), template: readTemplate('page.html') });
  assert.ok(html.includes('tested: 12 pass'));
  assert.ok(!html.includes('what was built'), 'a card past its 48 hours is not on the page');
});

test('`soloagile board` leaves the finished cards out, and counts them by milestone', () => {
  const open = openBoard(archiveBoard(BOARD, '', TODAY).board);
  assert.ok(open.includes('- #8 Still to do · M2 · 2 pts\n  done when: it is done'));
  assert.ok(!open.includes('#7'));
  assert.match(open, /## Done\n3 finished cards, not shown here: M1 1, M2 2\. /);
  assert.ok(openBoard(BOARD.replace(/## Done[^]*/, '## Done\n')).trimEnd().endsWith('## Done'));
});

test('`soloagile finished` gives the cards of a milestone, or one card, in full', () => {
  const { archive } = archiveBoard(BOARD, '', TODAY);
  assert.deepEqual(finishedCards(archive, ['M1']).match(/^- #\d+/gm), ['- #5', '- #4']);
  assert.equal(finishedCards(archive, ['#7']), '- #7 Fresh, with its text · M2 · 3 pts · 2026-10-13\n  the short line\n  tested: 12 pass\n');
  assert.equal(finishedCards(archive, ['6', 'M9']), '- #6 Fresh, already short · M2 · 1 pt · 2026-10-12\n');
});

test('the commands: archive rewrites both files and the page; board and finished print', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pm-archive-'));
  mkdirSync(join(repo, 'pm'));
  // Dated today, so the card is inside its 48 hours whenever the test runs.
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  writeFileSync(join(repo, 'pm', 'board.md'), BOARD.replaceAll('2026-10-13', today));
  const run = (...args) => spawnSync(PM, args, { cwd: repo, encoding: 'utf8' });
  const r = run('archive');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /4 finished cards are in pm\/finished-cards\.md/);
  assert.ok(readFileSync(join(repo, 'pm', 'finished-cards.md'), 'utf8').includes('tested: 12 pass'));
  assert.ok(!readFileSync(join(repo, 'pm', 'board.md'), 'utf8').includes('tested: 12 pass'));
  assert.ok(readFileSync(join(repo, 'pm', 'index.html'), 'utf8').includes('tested: 12 pass'));
  assert.ok(run('board').stdout.includes('finished cards, not shown here'));
  assert.ok(run('finished', '7').stdout.includes('tested: 12 pass'));
  assert.equal(run('finished').status, 2);
});
