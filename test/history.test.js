import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import './isolate.js';
import { parseBoard } from '../src/board.js';
import { buildProject } from '../src/build.js';
import { formatEvent, movesBetween, parseHistory, recordMoves, replay } from '../src/history.js';
import { isStale } from '../src/hook.js';

// A board with one card per line of `lanes`, e.g. { 'Up next': ['#1 A card · M1 · 3 pts'] }.
const board = (lanes = {}) =>
  `# Board\n<!-- next-id: 99 -->\n${['Ideas', 'Up next', 'Doing', 'Needs your look', 'Needs your decision', 'Done']
    .map((lane) => `## ${lane}\n${(lanes[lane] ?? []).map((c) => `- ${c}\n`).join('')}`)
    .join('')}`;

function project() {
  const repo = mkdtempSync(join(tmpdir(), 'pm-history-'));
  mkdirSync(join(repo, 'pm'));
  return repo;
}
const lines = (repo) => readFileSync(join(repo, 'pm', 'history.md'), 'utf8').split('\n').filter((l) => l.startsWith('- '));
const at = (h, m) => new Date(2026, 9, 2, h, m);

test('the first build writes one line per card, timed to the minute', () => {
  const repo = project();
  const added = recordMoves(repo, board({ 'Up next': ['#1 A card · M1 · 3 pts'], Ideas: ['#2 An idea · 1 pt'] }), at(14, 31));
  assert.equal(added, 2);
  assert.deepEqual(lines(repo), ['- 2026-10-02 14:31 · Ideas · #2 An idea · 1 pt', '- 2026-10-02 14:31 · Up next · #1 A card · M1 · 3 pts']);
});

test('a move adds one line; a rebuild with nothing moved adds none', () => {
  const repo = project();
  recordMoves(repo, board({ 'Up next': ['#1 A card · M1 · 3 pts'] }), at(9, 0));
  assert.equal(recordMoves(repo, board({ Doing: ['#1 A card · M1 · 3 pts · test'] }), at(9, 30)), 1);
  const before = readFileSync(join(repo, 'pm', 'history.md'), 'utf8');
  assert.equal(recordMoves(repo, board({ Doing: ['#1 A card · M1 · 3 pts · test'] }), at(9, 45)), 0);
  assert.equal(readFileSync(join(repo, 'pm', 'history.md'), 'utf8'), before);
  assert.equal(lines(repo).at(-1), '- 2026-10-02 09:30 · Doing · #1 A card · M1 · 3 pts · test');
});

test('a Doing card with no stage written is logged as develop, and each stage change is a line', () => {
  const repo = project();
  recordMoves(repo, board({ Doing: ['#1 A card · M1 · 3 pts'] }), at(9, 0));
  recordMoves(repo, board({ Doing: ['#1 A card · M1 · 3 pts · release'] }), at(10, 0));
  recordMoves(repo, board({ 'Needs your look': ['#1 A card · M1 · 3 pts · live 2026-10-02'] }), at(11, 0));
  assert.deepEqual(parseHistory(lines(repo).join('\n')).map((e) => [e.at.slice(11), e.lane, e.stage]), [
    ['09:00', 'Doing', 'develop'],
    ['10:00', 'Doing', 'release'],
    ['11:00', 'Needs your look', null],
  ]);
});

test('a design waiting on the user is logged with its stage', () => {
  const b = parseBoard(board({ 'Needs your decision': ['#1 A card · M1 · 5 pts · design · asked 2026-10-02', '#2 A question? · M1 · asked 2026-10-02'] }));
  assert.deepEqual(movesBetween(new Map(), b, '2026-10-02 09:00').map(formatEvent), [
    '- 2026-10-02 09:00 · Needs your decision · #1 A card · M1 · 5 pts · design',
    '- 2026-10-02 09:00 · Needs your decision · #2 A question? · M1',
  ]);
});

test('a card that leaves the board is logged as gone, and replaying the log gives the board', () => {
  const repo = project();
  recordMoves(repo, board({ Done: ['#1 Old · M1 · 2 pts · 2026-09-30'], Doing: ['#2 New · M1 · 1 pt'] }), at(9, 0));
  recordMoves(repo, board({ Doing: ['#2 New · M1 · 1 pt'] }), at(12, 0));
  assert.equal(lines(repo).at(-1), '- 2026-10-02 12:00 · gone · #1 Old · M1 · 2 pts');
  const state = replay(parseHistory(lines(repo).join('\n')));
  assert.equal(state.get(1).lane, 'gone');
  assert.equal(state.get(2).lane, 'Doing');
});

test('a card off the board for a moment, mid-move, shows as one move', () => {
  const repo = project();
  recordMoves(repo, board({ 'Up next': ['#1 A card · M1 · 3 pts'] }), at(9, 0));
  recordMoves(repo, board(), at(9, 5));
  assert.match(lines(repo).at(-1), /· gone ·/);
  recordMoves(repo, board({ Doing: ['#1 A card · M1 · 3 pts'] }), at(9, 6));
  assert.deepEqual(lines(repo), ['- 2026-10-02 09:00 · Up next · #1 A card · M1 · 3 pts', '- 2026-10-02 09:06 · Doing · #1 A card · M1 · 3 pts · develop']);
});

test('a card that comes back unchanged at once leaves no trace; one back after an hour keeps its gone line', () => {
  const repo = project();
  const b = board({ 'Up next': ['#1 A card · M1 · 3 pts'] });
  recordMoves(repo, b, at(9, 0));
  recordMoves(repo, board(), at(9, 5));
  recordMoves(repo, b, at(9, 6));
  assert.equal(lines(repo).length, 1);
  recordMoves(repo, board(), at(10, 0));
  recordMoves(repo, b, at(11, 0));
  assert.deepEqual(lines(repo).map((l) => l.split(' · ')[1]), ['Up next', 'gone', 'Up next']);
});

test('every line reads back as written, even a title with a middle dot', () => {
  const b = parseBoard(board({ Doing: ['#7 Light · dark page · M1 · 1 pt · test'], Ideas: ['#8 No points yet'] }));
  const written = movesBetween(new Map(), b, '2026-10-02 09:00').map(formatEvent);
  assert.deepEqual(parseHistory(written.join('\n')).map(formatEvent), written);
});

test('the first build fills in earlier days from git', () => {
  const repo = project();
  const git = (date, ...args) =>
    spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
  const commit = (md, date) => {
    writeFileSync(join(repo, 'pm', 'board.md'), md);
    git(date, 'add', '-A');
    assert.equal(git(date, 'commit', '-q', '-m', 'board').status, 0);
  };
  git('', 'init', '-q');
  commit(board({ 'Up next': ['#1 A card · M1 · 3 pts'] }), '2026-09-30T10:00:00');
  commit(board({ Doing: ['#1 A card · M1 · 3 pts'] }), '2026-10-01T16:20:00');
  const now = board({ Done: ['#1 A card · M1 · 3 pts · 2026-10-02'] });
  recordMoves(repo, now, at(14, 31));
  assert.deepEqual(lines(repo), [
    '- 2026-09-30 10:00 · Up next · #1 A card · M1 · 3 pts',
    '- 2026-10-01 16:20 · Doing · #1 A card · M1 · 3 pts · develop',
    '- 2026-10-02 14:31 · Done · #1 A card · M1 · 3 pts',
  ]);
});

test('soloagile build writes the log, and the page is still up to date after it', () => {
  const repo = project();
  writeFileSync(join(repo, 'pm', 'board.md'), board({ 'Up next': ['#1 A card · M1 · 3 pts\n  done when: it shows'] }));
  const { problems } = buildProject(repo, at(14, 31));
  assert.deepEqual(problems, []);
  assert.deepEqual(lines(repo), ['- 2026-10-02 14:31 · Up next · #1 A card · M1 · 3 pts']);
  assert.equal(isStale(repo), false);
});

test('a guessed build time is kept in the history, and a new guess is a new line', () => {
  const repo = project();
  recordMoves(repo, board({ 'Up next': ['#1 A card · M1 · 3 pts · ~40 min'] }), at(9, 0));
  assert.equal(recordMoves(repo, board({ 'Up next': ['#1 A card · M1 · 3 pts · ~2.5 h'] }), at(9, 30)), 1);
  assert.deepEqual(lines(repo), ['- 2026-10-02 09:00 · Up next · #1 A card · M1 · 3 pts · ~40 min', '- 2026-10-02 09:30 · Up next · #1 A card · M1 · 3 pts · ~2.5 h']);
  assert.equal(parseHistory(readFileSync(join(repo, 'pm', 'history.md'), 'utf8'))[1].guess, 150);
});
