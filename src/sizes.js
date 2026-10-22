// soloagile sizes: how long this project's finished cards of each size took to build, with
// a couple of them as examples. The session start gives Claude this table, so a new card's
// guessed build time (--guess) comes from the project's own past, not from thin air.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseHistory } from './history.js';
import { MOVED_AFTER, SIZES, buildTimes, duration, median } from './reports.js';

// [{ size, usual, count, examples: [{ id, title, minutes }] }] for each size with a
// finished card. The examples are the two cards closest to the usual time.
export function sizeTable(events) {
  const titles = new Map(events.map((e) => [e.id, e.title]));
  const cards = buildTimes(events).filter((c) => c.minutes >= MOVED_AFTER);
  return SIZES.map((size) => {
    const mine = cards.filter((c) => c.points === size);
    if (!mine.length) return null;
    const usual = median(mine.map((c) => c.minutes));
    const examples = [...mine]
      .sort((a, b) => Math.abs(a.minutes - usual) - Math.abs(b.minutes - usual) || a.id - b.id)
      .slice(0, 2)
      .map((c) => ({ id: c.id, title: titles.get(c.id), minutes: c.minutes }));
    return { size, usual, count: mine.length, examples };
  }).filter(Boolean);
}

// Long titles are cut, so each size stays one readable line.
const short = (t, max = 60) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);
const pts = (n) => `${n} pt${n === 1 ? '' : 's'}`;

// `examples: false` leaves out the example cards, for a session start short of room.
export function sizesText(events, { examples = true } = {}) {
  const rows = sizeTable(events);
  if (!rows.length) return 'No finished cards yet, so guess each new card\'s build time from the card itself.';
  return [
    "Build times from this project's finished cards (time spent in Doing). Guess a new card's time from these, with --guess:",
    ...rows.map(
      (r) =>
        `- ${pts(r.size)}: usually ${duration(r.usual)} (${r.count} card${r.count === 1 ? '' : 's'})${examples ? `, such as ${r.examples
          .map((e) => `#${e.id} ${short(e.title)} (${duration(e.minutes)})`)
          .join(' and ')}` : ''}`,
    ),
  ].join('\n');
}

// The table for a project, read from its pm/history.md.
export function readSizes(repo, options) {
  const file = join(resolve(repo), 'pm', 'history.md');
  return sizesText(existsSync(file) ? parseHistory(readFileSync(file, 'utf8')) : [], options);
}
