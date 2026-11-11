import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCardLine } from '../src/board.js';
import { addCard } from '../src/card.js';
import { builtCards, guessRange, guessSays, rangeOf, replayRanges } from '../src/guess.js';
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
