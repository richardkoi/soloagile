// soloagile guess: a new card's build time as a range, learned from the project's own
// finished cards and kept apart from its points (M29, #208).
//
// Why a range from past times and not a per-card read: on weatherglider's history, points
// didn't predict time (correlation -0.01), and in #212's trial Claude's own read of 50 cards,
// shown similar finished cards and their times, did no better than the project's median
// (25 of 50 within half to double, against 28). The middle 60% of recent times, though,
// holds about 6 in 10 new cards, so the range is honest about how sure it is.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseHistory } from './history.js';
import { MOVED_AFTER } from './reports.js';

// The range runs from the 20th to the 80th percentile of the last WINDOW finished cards.
// Cards over LONGEST minutes in Doing were left there (overnight, waiting), not built that
// long, so they are left out, as are cards moved through in under MOVED_AFTER minutes.
export const LOW = 0.2;
export const HIGH = 0.8;
export const WINDOW = 150;
export const LONGEST = 600;
// Fewer finished cards than this and there is no range yet: Claude guesses from the card.
export const FEWEST = 5;

const when = (at) => new Date(at.replace(' ', 'T')).getTime();

// Each built card in the order it first reached the user's look:
// [{ id, minutes, start, end }], start being when it first went into Doing. Time is
// counted as buildTimes counts it: only while in Doing, or a design waiting on the user.
export function builtCards(events) {
  const cards = new Map();
  for (const e of events) {
    const c = cards.get(e.id) ?? { id: e.id, since: null, worked: 0, start: null, end: null };
    cards.set(e.id, c);
    if (c.end !== null) continue;
    const working = e.lane === 'Doing' || (e.lane === 'Needs your decision' && e.stage === 'design');
    if (c.since !== null && !working) {
      c.worked += when(e.at) - c.since;
      c.since = null;
    } else if (working && c.since === null) {
      c.since = when(e.at);
      c.start ??= c.since;
    }
    if ((e.lane === 'Needs your look' || e.lane === 'Done') && c.start !== null) c.end = when(e.at);
  }
  return [...cards.values()]
    .filter((c) => c.end !== null)
    .map((c) => ({ id: c.id, minutes: Math.max(1, Math.round(c.worked / 60000)), start: c.start, end: c.end }))
    .sort((a, b) => a.end - b.end || a.id - b.id);
}

const counts = (c) => c.minutes >= MOVED_AFTER && c.minutes <= LONGEST;

function quantile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

// The range from a list of built cards, oldest first: { mid, low, high, count } or null.
export function rangeOf(cards) {
  const recent = cards.filter(counts).slice(-WINDOW);
  if (recent.length < FEWEST) return null;
  const times = recent.map((c) => c.minutes).sort((a, b) => a - b);
  return { mid: quantile(times, 0.5), low: quantile(times, LOW), high: quantile(times, HIGH), count: recent.length };
}

// The range a card added now gets.
export const guessRange = (events) => rangeOf(builtCards(events));

// Replaying the history: each built card is guessed only from the cards that reached the
// look before it first went into Doing. Counts, as M29's done when says, the cards with
// MOVED_AFTER minutes to LONGEST in Doing that had a range: { inside, of }.
export function replayRanges(events) {
  const cards = builtCards(events);
  let inside = 0;
  let of = 0;
  for (const c of cards) {
    if (!counts(c)) continue;
    const r = rangeOf(cards.filter((p) => p.end < c.start));
    if (!r) continue;
    of++;
    if (c.minutes >= r.low && c.minutes <= r.high) inside++;
  }
  return { inside, of };
}

// What `soloagile guess` prints, and the session start's line about guesses.
export function guessSays(events) {
  const r = guessRange(events);
  if (!r) return "Time guesses: too few finished cards yet, so guess each new card's build time from the card itself, with --guess.";
  return `Time guesses: card add gives a new card ~${r.mid} min, likely ${r.low}-${r.high} min, from this project's last ${r.count} finished cards (6 in 10 land inside). Points are a card's size only, not its time. Give --guess only when you know the card is unusual.`;
}

export function readGuess(repo) {
  const file = join(resolve(repo), 'pm', 'history.md');
  return existsSync(file) ? parseHistory(readFileSync(file, 'utf8')) : [];
}
