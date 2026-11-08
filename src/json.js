// soloagile board --json: the board in one fixed shape, for other tools to read (#193).
// A Herdr add-on, a status bar or a script reads this instead of parsing pm/board.md, so a
// change to the Markdown never breaks them. `format` goes up only when a field is removed
// or changes meaning; new fields may be added at any time.
import { closeSync, existsSync, openSync, readSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { COLUMNS, parseBoard, parsePlan, stageOf } from './board.js';
import { heldBy, nextMove, waitingLooks } from './next.js';

const FORMAT = 1;

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const OPTION = /^(\d+)-([a-z])\.png$/;
// An address in a card's note, up to a space or a closing bracket; a full stop or comma
// that ends the sentence is not part of it.
const LINK = /https?:\/\/[^\s<>()"']+/g;
const linksIn = (details) => details.flatMap((d) => (d.match(LINK) ?? []).map((u) => u.replace(/[.,;:!?]+$/, '')));

// A PNG's width and height in pixels, from its first 24 bytes; null for anything else.
function pngSize(file) {
  const head = Buffer.alloc(24);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, head, 0, 24, 0);
  } finally {
    closeSync(fd);
  }
  return head.toString('latin1', 1, 4) === 'PNG' && head.toString('latin1', 12, 16) === 'IHDR'
    ? { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
    : { width: null, height: null };
}

// Each card's pictures, read from pm/designs: its own picture page's images (soloagile
// pictures, in designs/card-<n>/) and its options' pictures (soloagile design,
// designs/<n>-<letter>.png). `page` is the project page's address, so each picture gets
// an address beside its file. Returns { [card id]: { pictures, picturePage } }.
export function cardPictures(pmDir, page) {
  const folder = join(pmDir, 'designs');
  const out = {};
  if (!existsSync(folder)) return out;
  const at = (rel) => (page && /^https?:/.test(page) ? new URL(rel, page.endsWith('/') ? page : `${page}/`).href : null);
  const entry = (id) => (out[id] ??= { pictures: [], picturePage: null });
  for (const f of readdirSync(folder).sort()) {
    const own = f.match(/^card-(\d+)$/)?.[1];
    if (own) {
      const dir = join(folder, f);
      const e = entry(Number(own));
      for (const x of readdirSync(dir).filter((x) => IMAGE.test(x)).sort()) e.pictures.push({ file: join(dir, x), url: at(`designs/${f}/${x}`), option: null, ...pngSize(join(dir, x)) });
      if (existsSync(join(dir, 'index.html'))) e.picturePage = at(`designs/${f}/index.html`);
      continue;
    }
    const opt = f.match(OPTION);
    if (opt) entry(Number(opt[1])).pictures.push({ file: join(folder, f), url: at(`designs/${f}`), option: opt[2], ...pngSize(join(folder, f)) });
  }
  return out;
}

// boardMd, planMd, archiveMd: the text of pm/board.md, pm/plan.md, pm/finished-cards.md.
// pictures: what cardPictures gives; left out, no card has any.
export function boardJson({ boardMd, planMd = '', archiveMd = '', name, today, page, pictures = {} }) {
  const board = parseBoard(boardMd);
  const lane = (n) => board.columns.find((c) => c.name === n)?.cards ?? [];
  const finished = parseBoard(`## Done\n${archiveMd.split('\n').filter((l) => /^- #\d+ /.test(l)).join('\n')}\n`).columns[0].cards;
  const done = [...lane('Done'), ...finished];

  const card = (c, column) => {
    const held = column === 'Up next' ? heldBy(c, today) : null;
    return {
      id: c.id,
      title: c.title,
      milestone: c.milestone,
      points: c.points,
      guess: c.guess,
      stage: stageOf(c, column),
      date: c.date,
      details: c.details,
      // Up next: what holds the card back, a date or an event such as "the next time the owner uses the laptop".
      waits: held ? (held.date ?? held.event) : null,
      // A look dated "from" a later day: not waiting on the user yet.
      later: column === 'Needs your look' && c.date?.label === 'from' && c.date.value > today,
      // Pictures: { file, url, option, width, height } each; option is the letter of a design
      // option's picture; width and height are in pixels, for PNGs only.
      pictures: pictures[c.id]?.pictures ?? [],
      picturePage: pictures[c.id]?.picturePage ?? null,
      links: linksIn(c.details),
    };
  };
  const lanes = COLUMNS.filter((n) => n !== 'Done').map((n) => ({ name: n, cards: lane(n).map((c) => card(c, n)) }));

  // Progress for each milestone that still has an open card, in plan order. Every card is
  // counted once, whether on the board or finished and archived.
  const open = new Set(lanes.flatMap((l) => l.cards.map((c) => c.milestone)).filter(Boolean));
  const all = new Map();
  for (const c of [...board.columns.flatMap((col) => col.cards), ...finished]) if (c.id !== null && c.milestone) all.set(c.id, c.milestone);
  const doneIds = new Set(done.map((c) => c.id));
  const plan = parsePlan(planMd).milestones;
  const order = [...plan.map((m) => m.id), ...[...open].filter((id) => !plan.some((m) => m.id === id))];
  const milestones = order.filter((id) => open.has(id)).map((id) => {
    const m = plan.find((p) => p.id === id);
    const ids = [...all].filter(([, ms]) => ms === id).map(([cid]) => cid);
    return {
      id,
      title: m?.title ?? null,
      short: m?.short ?? null,
      status: m?.status ?? null,
      done: ids.filter((cid) => doneIds.has(cid)).length,
      total: ids.length,
    };
  });

  const decisions = lane('Needs your decision').length;
  const looks = waitingLooks(board, today).length;
  return {
    format: FORMAT,
    project: name,
    page,
    counts: {
      decisions,
      looks,
      waiting: decisions + looks,
      doing: lane('Doing').length,
      upNext: lane('Up next').length,
      ideas: lane('Ideas').length,
      done: lane('Done').length,
    },
    next: nextMove(board, today),
    lanes,
    milestones,
  };
}
