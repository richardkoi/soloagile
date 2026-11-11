import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCardLine } from '../src/board.js';
import { addCard } from '../src/card.js';
import { batchGuess, batchText, builtCards, byWhen, cardsLeft, guessRange, guessSays, leftSays, overrunning, rangeOf, replayBatches, replayLeft, replayRanges, shares } from '../src/guess.js';
import { formatEvent, parseHistory } from '../src/history.js';

// A card that spent `minutes` in Doing, then reached the user's look, one after another.
let clock = 0;
function built(id, minutes) {
  const at = (m) => new Date(Date.UTC(2026, 9, 1, 0, clock + m)).toISOString().slice(0, 16).replace('T', ' ');
  const lines = [`- ${at(0)} · Doing · #${id} Card ${id} · M1 · 2 pts · develop`, `- ${at(minutes)} · Needs your look · #${id} Card ${id} · M1 · 2 pts`];
  clock += minutes + 10;
  return lines;
}
const history = (times) => parseHistory(times.flatMap((m, i) => built(i + 1, m)).join('\n'));

test('the range is the middle and the 20th to 80th percentile of the finished cards', () => {
  const r = guessRange(history([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]));
  assert.deepEqual(r, { mid: 60, low: 30, high: 90, count: 10 });
});

test('cards moved through in minutes, or left in Doing over 10 hours, are left out', () => {
  const r = guessRange(history([1, 2, 700, 900, 20, 30, 40, 50, 60]));
  assert.equal(r.count, 5);
  assert.equal(guessRange(history([20, 30, 1, 900])), null);
  assert.match(guessSays([]), /too few finished cards/);
});

test('the replay guesses each card only from cards finished before it started', () => {
  const events = history([30, 30, 30, 30, 30, 30, 200]);
  assert.deepEqual(replayRanges(events), { inside: 1, of: 2 });
  assert.equal(builtCards(events).length, 7);
  assert.equal(rangeOf(builtCards(events).slice(0, 4)), null);
});

test('a guess carries its range on the card line and in the history, and parses back', () => {
  const c = parseCardLine('#9 A card · M1 · 3 pts · ~35 min (20-65 min) · develop');
  assert.equal(c.guess, 35);
  assert.deepEqual(c.range, [20, 65]);
  assert.equal(c.stage, 'develop');
  assert.equal(parseCardLine('#9 A card · M1 · 3 pts · ~2.5 h').range, null);
  const line = formatEvent({ at: '2026-11-11 10:00', lane: 'Up next', id: 9, title: 'A card', milestone: 'M1', points: 3, guess: 35, range: [20, 65], stage: null });
  assert.deepEqual(parseHistory(line)[0].range, [20, 65]);
});

const BOARD = '# Board\n<!-- next-id: 1 -->\n\n## Ideas\n\n## Up next\n\n## Doing\n\n## Needs your look\n\n## Needs your decision\n\n## Done\n';
const PLAN = '# Plan\n\n### M1 — First · not started\n';

test('card add with no --guess takes the middle and the range from the past', () => {
  const past = { mid: 35, low: 20, high: 65, count: 40 };
  const r = addCard(BOARD, PLAN, { title: 'New card', milestone: 'M1', points: 3, doneWhen: 'it works', today: '2026-11-11', past });
  assert.match(r.board, /- #1 New card · M1 · 3 pts · ~35 min \(20-65 min\)/);
  const byHand = addCard(BOARD, PLAN, { title: 'New card', milestone: 'M1', points: 3, guess: 90, doneWhen: 'it works', today: '2026-11-11', past });
  assert.match(byHand.board, /- #1 New card · M1 · 3 pts · ~90 min\n/);
  const question = addCard(BOARD, PLAN, { title: 'Which?', milestone: 'M1', lane: 'decision', options: ['a', 'b'], today: '2026-11-11', past });
  assert.doesNotMatch(question.board, /min/);
});

// Cards with given Doing spells, in minutes from a start; each reaches the look at its end.
function spells(cards, day = 1) {
  const at = (m) => new Date(Date.UTC(2026, 9, day, 8, m)).toISOString().slice(0, 16).replace('T', ' ');
  const lines = cards.flatMap(([id, from, to]) => [
    [from, `- ${at(from)} · Doing · #${id} Card ${id} · M1 · 2 pts · develop`],
    [to, `- ${at(to)} · Needs your look · #${id} Card ${id} · M1 · 2 pts`],
  ]);
  return lines.sort((a, b) => a[0] - b[0]).map((l) => l[1]);
}

test('two cards built side by side share the busy time between them', () => {
  const list = shares(parseHistory(spells([[1, 0, 60], [2, 30, 90]]).join('\n')));
  assert.deepEqual(list.map((s) => [s.id, Math.round(s.share), Math.round(s.together * 10) / 10]), [[1, 45, 1.5], [2, 45, 1.5]]);
});

test('a batch guess is likely then surely, learned from past days, and needs three of them', () => {
  const day = (d, n) => spells(Array.from({ length: n }, (_, i) => [d * 10 + i, i * 30, i * 30 + 30]), d);
  const three = parseHistory([...day(1, 3), ...day(2, 3)].join('\n'));
  assert.equal(batchGuess(three, 4), null);
  const events = parseHistory([...day(1, 3), ...day(2, 3), ...day(3, 4), ...day(4, 4)].join('\n'));
  assert.deepEqual(batchGuess(events, 4), { likely: 120, surely: 120, days: 4 });
  assert.equal(batchText({ likely: 210, surely: 300 }), 'likely 3.5 h · surely 5 h');
  assert.deepEqual(replayBatches(events), { held: 1, of: 1, under: 1 });
});

test('the end of a batch says the day when it is not today', () => {
  const from = new Date(2026, 10, 11, 16, 0);
  assert.equal(byWhen(from, 30), '16:30');
  assert.equal(byWhen(from, 24 * 60), 'Thu 16:00');
});

test('a milestone counts its cards still to build, not its finished ones or questions', () => {
  const board = { columns: [
    { name: 'Up next', cards: [{ milestone: 'M2', points: 3 }, { milestone: 'M1', points: 2 }] },
    { name: 'Doing', cards: [{ milestone: 'M2', points: 5 }] },
    { name: 'Needs your decision', cards: [{ milestone: 'M2', points: null }] },
    { name: 'Done', cards: [{ milestone: 'M2', points: 1 }] },
  ] };
  assert.equal(cardsLeft(board, 'M2'), 2);
});

test('a card in Doing past the top of its range is flagged, and what is left is said', () => {
  const events = parseHistory('- 2026-11-11 10:00 · Doing · #7 Long one · M1 · 3 pts · ~35 min (20-65 min) · develop');
  const board = { columns: [
    { name: 'Up next', cards: [{ id: 8, points: 2 }, { id: 9, points: null }] },
    { name: 'Doing', cards: [{ id: 7, points: 3, range: [20, 65] }] },
  ] };
  assert.deepEqual(overrunning(events, board, new Date(2026, 10, 11, 11, 30)), [{ id: 7, minutes: 90, high: 65 }]);
  assert.deepEqual(overrunning(events, board, new Date(2026, 10, 11, 10, 30)), []);
  assert.equal(leftSays(events, board), "What's left: 1 in Up next and 1 in Doing; too few past days to guess from yet.");
  assert.equal(leftSays(events, { columns: [] }), "What's left: nothing in Up next or Doing.");
});

test('the what-is-left replay guesses the rest of each busy day after each card lands', () => {
  const day = (d, n) => spells(Array.from({ length: n }, (_, i) => [d * 10 + i, i * 30, i * 30 + 30]), d);
  const events = parseHistory([...day(1, 3), ...day(2, 3), ...day(3, 4), ...day(4, 4)].join('\n'));
  assert.deepEqual(replayLeft(events), { held: 3, of: 3, under: 3 });
});

test('the learning report: inside range by week, guesses beside the median, and each day', async () => {
  const { learningReport } = await import('../src/learning.js');
  const { cardRows, dayRows } = await import('../src/guess.js');
  const day = (d, n) => spells(Array.from({ length: n }, (_, i) => [d * 10 + i, i * 30, i * 30 + 30]), d);
  const events = parseHistory([...day(1, 3), ...day(2, 3), ...day(3, 4), ...day(4, 4)].join('\n'));
  const rows = cardRows(events);
  assert.equal(rows.length, 14);
  assert.deepEqual(rows.filter((r) => r.low !== null).map((r) => [r.low, r.high, r.median, r.minutes])[0], [30, 30, 30, 30]);
  assert.deepEqual(dayRows(events).map((d) => [d.cards, d.likely, d.surely, d.took]), [[4, 120, 120, 120]]);
  const html = learningReport(events);
  assert.match(html, /Are the guesses learning\?/);
  assert.match(html, /No card carries a range yet; replayed on the past, 8 of 8 cards \(100%\)/);
  assert.match(html, /1 of 1 took no longer than 'surely'/);
  assert.equal(learningReport([]), '');
});
