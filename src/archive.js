// pm/finished-cards.md: every finished card, in full, newest first. A card the user approved
// keeps one line in board.md's Done for 48 hours, so the page shows what just finished,
// and its detail lines live here. Sessions read the board many times a day; this keeps
// finished work out of what they read. Behind `soloagile archive`, `board` and `finished`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseBoard, parseCardLine } from './board.js';

export const ARCHIVE = 'finished-cards.md';
const HEADER = `# Finished cards, in full

Written by \`soloagile archive\`: each finished card as it stood when the user approved it,
newest first. Read one with \`soloagile finished <card number or milestone>\`.

`;

// Done cards carry only a date, so "48 hours" is the day a card finished and the two days
// after: one finished on 30 Sep shows through 2 Oct. `today` is YYYY-MM-DD.
export const DONE_DAYS = 2;
export function doneCutoff(today) {
  const [y, m, d] = today.split('-').map(Number);
  const from = new Date(y, m - 1, d - DONE_DAYS);
  return `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
}

// Text -> { head, cards }: `head` is whatever comes before the first card, and each card
// is its "- " line with every line under it, as written.
function blocks(text) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const first = lines.findIndex((l) => l.startsWith('- '));
  if (first < 0) return { head: lines, cards: [] };
  const cards = [];
  for (const line of lines.slice(first)) {
    if (line.startsWith('- ')) cards.push({ ...parseCardLine(line.slice(2)), lines: [line] });
    else cards.at(-1).lines.push(line);
  }
  // Blank lines at a card's foot belong to the file's layout, not the card.
  for (const c of cards) while (c.lines.length > 1 && !c.lines.at(-1).trim()) c.lines.pop();
  return { head: lines.slice(0, first), cards };
}

// Moves every Done card's detail lines from the board to the archive, and takes Done
// cards past their 48 hours off the board. Returns both files' new text, the ids whose
// entry in the archive was written (`moved`) and those that left the board (`left`).
export function archiveBoard(boardMd, archiveMd, today) {
  const at = boardMd.search(/^## Done[ \t]*$/m);
  if (at < 0) return { board: boardMd, archive: archiveMd, moved: [], left: [] };
  const bodyAt = boardMd.indexOf('\n', at) + 1 || boardMd.length;
  const next = boardMd.slice(bodyAt).search(/^## /m);
  const end = next < 0 ? boardMd.length : bodyAt + next;
  const done = blocks(boardMd.slice(bodyAt, end));
  const kept = blocks(archiveMd);
  const cutoff = doneCutoff(today);

  const moved = [];
  const left = [];
  const fresh = [];
  for (const c of done.cards) {
    if (c.id === null) continue;
    const was = kept.cards.find((k) => k.id === c.id);
    // Nothing kept is ever lost: a short line leaves its card's entry alone, and lines
    // added to a card that was finished before (a fix, a second look) join the ones kept.
    if (c.lines.length > 1 || !was) {
      const old = was ? was.lines.slice(1) : [];
      fresh.push({ id: c.id, lines: [c.lines[0], ...old, ...c.lines.slice(1).filter((l) => !old.includes(l))] });
      moved.push(c.id);
    }
    if (c.date && c.date.value < cutoff) left.push(c.id);
  }
  const stays = done.cards.filter((c) => !left.includes(c.id));
  const doneText = [...done.head, ...stays.map((c) => (c.id === null ? c.lines.join('\n') : c.lines[0]))].join('\n');
  const tail = boardMd.slice(end);
  const board = `${boardMd.slice(0, bodyAt)}${doneText ? `${doneText}\n` : ''}${tail && doneText ? '\n' : ''}${tail}`;

  const entries = [...fresh, ...kept.cards.filter((k) => !fresh.some((f) => f.id === k.id))];
  const head = archiveMd.trim() ? `${kept.head.join('\n')}\n` : HEADER;
  const archive = moved.length ? `${head}${entries.map((e) => e.lines.join('\n')).join('\n')}\n` : archiveMd;
  return { board: moved.length || left.length ? board : boardMd, archive, moved, left };
}

// Each archived card's detail lines, by id, for the page: a Done card opens in full.
export function archivedDetails(archiveMd) {
  const cards = parseBoard(`## Done\n${blocks(archiveMd).cards.map((c) => c.lines.join('\n')).join('\n')}\n`).columns[0].cards;
  return new Map(cards.filter((c) => c.id !== null).map((c) => [c.id, c.details]));
}

// The board as a session needs it: every open card in full, and Done as one line that
// counts the finished cards by milestone.
export function openBoard(boardMd) {
  const at = boardMd.search(/^## Done[ \t]*$/m);
  if (at < 0) return boardMd;
  const cards = parseBoard(boardMd).columns.find((c) => c.name === 'Done')?.cards ?? [];
  if (!cards.length) return `${boardMd.slice(0, at)}## Done\n`;
  const by = new Map();
  for (const c of cards) by.set(c.milestone ?? 'no milestone', (by.get(c.milestone ?? 'no milestone') ?? 0) + 1);
  const counts = [...by].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })).map(([m, n]) => `${m} ${n}`).join(', ');
  const n = cards.length;
  return `${boardMd.slice(0, at)}## Done\n${n} finished card${n === 1 ? '' : 's'}, not shown here: ${counts}. To read them in full: \`soloagile finished <milestone>\`, or \`soloagile finished <card number>\`.\n`;
}

// The archived cards that `wants` names, in full: "M3" for a milestone's, "12" or "#12" for one.
export function finishedCards(archiveMd, wants) {
  const ids = wants.map((w) => w.match(/^#?(\d+)$/)?.[1]).filter(Boolean).map(Number);
  const milestones = wants.filter((w) => /^M\d+$/.test(w));
  return blocks(archiveMd)
    .cards.filter((c) => ids.includes(c.id) || milestones.includes(c.milestone))
    .map((c) => `${c.lines.join('\n')}\n`)
    .join('');
}

const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

// `soloagile archive`: brings <repo>/pm/board.md and the archive up to date.
export function archiveProject(repoPath, today) {
  const dir = join(resolve(repoPath), 'pm');
  const file = join(dir, 'board.md');
  if (!existsSync(file)) throw new Error(`no pm/board.md in ${resolve(repoPath)}`);
  const before = readFileSync(file, 'utf8');
  const r = archiveBoard(before, read(join(dir, ARCHIVE)), today);
  if (r.moved.length) writeFileSync(join(dir, ARCHIVE), r.archive);
  if (r.board !== before) writeFileSync(file, r.board);
  return r;
}

export const readArchive = (repoPath) => read(join(resolve(repoPath), 'pm', ARCHIVE));
