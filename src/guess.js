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

// ---- A batch's guess (#209) ------------------------------------------------------------
// Card times overlap when helpers build several at once, so a batch's time is not the sum
// of its cards' times (summed, they missed weatherglider's days 10 times in 15). Each built
// card gets a share of the busy time instead: every minute it was in Doing is split evenly
// between the cards in Doing at that minute. A day's shares add up to its busy time.

// Each built card's Doing spells: [{ id, spells: [[from, to]], minutes, start, end }].
function spellsOf(events) {
  const cards = new Map();
  for (const e of events) {
    const c = cards.get(e.id) ?? { id: e.id, since: null, spells: [], start: null, end: null };
    cards.set(e.id, c);
    if (c.end !== null) continue;
    const working = e.lane === 'Doing' || (e.lane === 'Needs your decision' && e.stage === 'design');
    if (c.since !== null && !working) {
      c.spells.push([c.since, when(e.at)]);
      c.since = null;
    } else if (working && c.since === null) {
      c.since = when(e.at);
      c.start ??= c.since;
    }
    if ((e.lane === 'Needs your look' || e.lane === 'Done') && c.start !== null) c.end = when(e.at);
  }
  return [...cards.values()]
    .filter((c) => c.end !== null && c.spells.length)
    .map((c) => ({ ...c, minutes: c.spells.reduce((s, [a, b]) => s + (b - a), 0) / 60000 }))
    .filter(counts);
}

// [{ id, share, together, start, end, day }], oldest first: share is the card's minutes of
// busy time; together is how many cards were in Doing with it, on average (1 = alone).
export function shares(events) {
  const cards = spellsOf(events);
  const cuts = [...new Set(cards.flatMap((c) => c.spells.flat()))].sort((a, b) => a - b);
  const share = new Map(cards.map((c) => [c.id, 0]));
  const crowd = new Map(cards.map((c) => [c.id, 0]));
  for (let i = 1; i < cuts.length; i++) {
    const [a, b] = [cuts[i - 1], cuts[i]];
    const on = cards.filter((c) => c.spells.some(([x, y]) => x <= a && y >= b));
    for (const c of on) {
      share.set(c.id, share.get(c.id) + (b - a) / 60000 / on.length);
      crowd.set(c.id, crowd.get(c.id) + ((b - a) / 60000) * on.length);
    }
  }
  const day = (t) => new Date(t).toDateString();
  return cards
    .map((c) => ({ id: c.id, share: share.get(c.id), together: crowd.get(c.id) / c.minutes, start: c.start, end: c.end, day: day(c.end) }))
    .sort((a, b) => a.end - b.end || a.id - b.id);
}

// A small seeded random number source, so the same history always gives the same guess.
function seeded(seed = 1) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The days to learn from: the last DAYS days with at least 3 built cards, each a list of
// its cards' shares. `helpers` keeps only days built alone (1) or several at once (2+).
const DAYS = 20;
function pastDays(list, helpers) {
  const days = new Map();
  for (const s of list) days.set(s.day, [...(days.get(s.day) ?? []), s]);
  let all = [...days.values()].filter((d) => d.length >= 3);
  if (helpers) {
    const alone = (d) => d.reduce((t, s) => t + s.together, 0) / d.length < 1.5;
    const picked = all.filter((d) => (helpers > 1 ? !alone(d) : alone(d)));
    if (picked.length >= 3) all = picked;
  }
  return all.slice(-DAYS).map((d) => d.map((s) => s.share));
}

// The guess for a batch of `n` cards: { likely, surely, days } in minutes of busy time, the
// 50th and 85th percentile of DRAWS made-up runs. Each made-up run picks one past day and
// draws the batch's cards from that day's shares, so a slow day stays slow throughout.
const DRAWS = 2000;
export function batchFrom(list, n, { helpers = 0 } = {}) {
  const days = pastDays(list, helpers);
  if (days.length < 3 || n < 1) return null;
  const random = seeded(n);
  const runs = [];
  for (let r = 0; r < DRAWS; r++) {
    const day = days[Math.floor(random() * days.length)];
    let sum = 0;
    for (let i = 0; i < n; i++) sum += day[Math.floor(random() * day.length)];
    runs.push(sum);
  }
  runs.sort((a, b) => a - b);
  return { likely: Math.round(quantile(runs, 0.5)), surely: Math.round(quantile(runs, 0.85)), days: days.length };
}

export const batchGuess = (events, n, options) => batchFrom(shares(events), n, options);

// Replaying the history: each day with at least 4 built cards is guessed as a batch from
// the days before it, and its busy time (its cards' shares added up) is compared with the
// guess. { held, of, under }: days whose time was within the 85% guess, of those guessed,
// and how many came in within the 50% guess.
export function replayBatches(events) {
  const list = shares(events);
  const days = new Map();
  for (const s of list) days.set(s.day, [...(days.get(s.day) ?? []), s]);
  let held = 0;
  let of = 0;
  let under = 0;
  for (const cards of days.values()) {
    if (cards.length < 4) continue;
    const first = Math.min(...cards.map((c) => c.start));
    const guess = batchFrom(list.filter((s) => s.end < first), cards.length);
    if (!guess) continue;
    const took = cards.reduce((t, c) => t + c.share, 0);
    of++;
    if (took <= guess.surely) held++;
    if (took <= guess.likely) under++;
  }
  return { held, of, under };
}

// "likely 3.5 h · surely 5 h", the way a batch's guess is said (#207, Rich's pick a).
export const batchText = (g, { clock = null } = {}) => {
  const at = (m) => (clock ? ` (by ${byWhen(clock, m)})` : '');
  return `likely ${spoken(g.likely)}${at(g.likely)} · surely ${spoken(g.surely)}${at(g.surely)}`;
};
const spoken = (m) => (m < 90 ? `${Math.max(1, Math.round(m))} min` : `${Math.round(m / 30) / 2} h`);
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
// "16:30" today; "Thu 16:30" on another day.
export function byWhen(from, minutes) {
  const end = new Date(from.getTime() + minutes * 60000);
  return end.toDateString() === from.toDateString() ? hhmm(end) : `${end.toLocaleDateString('en-GB', { weekday: 'short' })} ${hhmm(end)}`;
}

// A milestone's cards still to build: in Up next, Doing, or a design waiting on the user.
export function cardsLeft(board, id) {
  const lanes = ['Up next', 'Doing', 'Needs your decision'];
  return board.columns.filter((c) => lanes.includes(c.name)).flatMap((c) => c.cards).filter((c) => c.milestone === id && c.points !== null).length;
}
