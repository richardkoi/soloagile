// soloagile board --json: the board in one fixed shape, for other tools to read (#193).
// A Herdr add-on, a status bar or a script reads this instead of parsing pm/board.md, so a
// change to the Markdown never breaks them. `format` goes up only when a field is removed
// or changes meaning; new fields may be added at any time.
import { COLUMNS, parseBoard, parsePlan, stageOf } from './board.js';
import { heldBy, nextMove, waitingLooks } from './next.js';

const FORMAT = 1;

// boardMd, planMd, archiveMd: the text of pm/board.md, pm/plan.md, pm/finished-cards.md.
export function boardJson({ boardMd, planMd = '', archiveMd = '', name, today, page }) {
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
      // Up next: what holds the card back, a date or an event such as "the next time Rich uses the laptop".
      waits: held ? (held.date ?? held.event) : null,
      // A look dated "from" a later day: not waiting on the user yet.
      later: column === 'Needs your look' && c.date?.label === 'from' && c.date.value > today,
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
