// The record of card moves behind the reports: pm/history.md, one line each time a
// card changes lane, stage, points, milestone or title. The board keeps no history,
// and Done cards leave it after 48 hours, so `soloagile build` writes each change down as it
// sees it. The times are the minute the board was edited, not the next commit.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { guessText, isDesign, parseBoard, parseCardLine, stageOf } from './board.js';

// The lane of a card that has left the board: removed from Done by /soloagile:save, or deleted.
export const GONE = 'gone';
// A card moved with two edits is on no lane for a moment. A "gone" this fresh is
// dropped when the card comes back, so the log shows one move.
const BLIP_MINUTES = 10;

const HEADER = `# History

Written by \`soloagile build\`: one line each time a card changes lane, stage, points, milestone
or title. The reports read it. Never edit by hand.

`;

const pad = (n) => String(n).padStart(2, '0');
// "2026-10-02 14:31", local time.
export const minute = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const minutesBetween = (a, b) => (new Date(b.replace(' ', 'T')) - new Date(a.replace(' ', 'T'))) / 60000;

// "- 2026-10-02 14:31 · Doing · #69 A record of every card move · M8 · 5 pts · develop":
// the time, the lane, then the card as board.md writes it.
const LINE = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · ([^·]+?) · (#\d+ .*)$/;

export function formatEvent(e) {
  const meta = [e.milestone, e.points !== null && `${e.points} pt${e.points === 1 ? '' : 's'}`, e.guess != null && guessText(e.guess), e.stage].filter(Boolean);
  return `- ${e.at} · ${e.lane} · #${e.id} ${e.title}${meta.map((m) => ` · ${m}`).join('')}`;
}

// history.md -> events, oldest first. Lines that aren't events are skipped.
export function parseHistory(md) {
  const events = [];
  for (const line of md.split('\n')) {
    const m = line.match(LINE);
    if (!m) continue;
    const { id, title, milestone, points, guess, stage } = parseCardLine(m[3]);
    events.push({ at: m[1], lane: m[2], id, title, milestone, points, guess, stage });
  }
  return events;
}

// Each card's latest event, by id. A card that left the board keeps its "gone" event.
export function replay(events) {
  const state = new Map();
  for (const e of events) state.set(e.id, e);
  return state;
}

// Where every card on the board is now, by id. Only a Doing card and a design waiting
// on the user have a stage of their own; every other lane implies it.
function cardsOn(board) {
  const now = new Map();
  for (const col of board.columns) {
    for (const c of col.cards) {
      if (c.id === null) continue;
      const stage = col.name === 'Doing' || isDesign(c, col.name) ? stageOf(c, col.name) : null;
      now.set(c.id, { lane: col.name, id: c.id, title: c.title, milestone: c.milestone, points: c.points, guess: c.guess, stage });
    }
  }
  return now;
}

const FIELDS = ['lane', 'title', 'milestone', 'points', 'guess', 'stage'];

// The events that take `state` to the board as it is now, all timed `at`.
export function movesBetween(state, board, at) {
  const now = cardsOn(board);
  const events = [];
  for (const [id, card] of now) {
    const was = state.get(id);
    if (!was || FIELDS.some((f) => was[f] !== card[f])) events.push({ at, ...card });
  }
  for (const [id, was] of state) {
    if (was.lane !== GONE && !now.has(id)) events.push({ ...was, at, lane: GONE, stage: null });
  }
  return events;
}

const git = (repo, ...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

// The days before the log existed, from every commit that changed pm/board.md. These
// are only as exact as the commits. A project with no git history gives none.
export function backfill(repo) {
  const log = git(repo, 'log', '--reverse', '--format=%H %ad', '--date=format-local:%Y-%m-%d %H:%M', '--', 'pm/board.md');
  if (log.status !== 0) return [];
  const events = [];
  for (const line of log.stdout.split('\n').filter(Boolean)) {
    const [sha, ...at] = line.split(' ');
    const show = git(repo, 'show', `${sha}:./pm/board.md`);
    if (show.status !== 0) continue;
    events.push(...movesBetween(replay(events), parseBoard(show.stdout), at.join(' ')));
  }
  return events;
}

// Brings <repo>/pm/history.md up to date with the board. The first time, git fills in
// the days already gone. Returns how many lines were added.
export function recordMoves(repo, boardMd, builtAt = new Date()) {
  const file = join(repo, 'pm', 'history.md');
  const isNew = !existsSync(file);
  const board = parseBoard(boardMd);
  const at = minute(builtAt);
  let events = isNew ? backfill(repo) : parseHistory(readFileSync(file, 'utf8'));

  const state = replay(events);
  const present = cardsOn(board);
  const blips = events.filter(
    (e) => e.lane === GONE && state.get(e.id) === e && present.has(e.id) && minutesBetween(e.at, at) <= BLIP_MINUTES,
  );
  if (blips.length) events = events.filter((e) => !blips.includes(e));

  const fresh = movesBetween(replay(events), board, at);
  if (!isNew && !blips.length && !fresh.length) return 0;
  writeFileSync(file, `${HEADER}${[...events, ...fresh].map(formatEvent).join('\n')}\n`);
  return fresh.length;
}
