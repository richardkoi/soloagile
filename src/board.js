// Parses pm/board.md and pm/plan.md (format: SPEC.md) into plain objects.
// Lenient on purpose: odd input never throws. Format slips come back as
// `problems` strings so `soloagile build` can print them for Claude to fix.

export const COLUMNS = ['Ideas', 'Up next', 'Doing', 'Needs your look', 'Needs your decision', 'Done'];

const DATE = /^(?:([a-z]+) )?(\d{4}-\d{2}-\d{2})$/; // "2026-09-30" or "built 2026-09-30"
const MILESTONE = /^M\d+$/;
const POINTS = /^(\d+) pts?$/; // "3 pts" or "1 pt"
const GUESS = /^~(\d+(?:\.\d+)?) (min|h)$/; // "~40 min" or "~2.5 h"
// Story points: Claude's quick guess at a card's size. 13 means "too big, split it".
export const SCALE = [1, 2, 3, 5, 8, 13];
// The wheel every card goes round, in order (SPEC.md, "The wheel").
export const STAGES = ['plan', 'design', 'develop', 'test', 'release', 'feedback'];
// The stages a card passes through while it sits in Doing.
const DOING_STAGES = STAGES.slice(1, 5);

// A guessed build time, in minutes, as a card writes it: "~40 min" under 2 hours, else
// hours to the half: "~2.5 h".
export const guessText = (minutes) => (minutes < 120 ? `~${Math.round(minutes)} min` : `~${Math.round(minutes / 30) / 2} h`);

// "#5 Board parser · M1 · 3 pts · ~40 min · test · built 2026-09-30"
//   -> { id, title, milestone, points, guess, stage, date, details }. guess is in minutes.
// Meta segments are peeled off the right, so a title may itself contain " · ".
export function parseCardLine(text) {
  const parts = text.split(' · ');
  let milestone = null;
  let points = null;
  let guess = null;
  let stage = null;
  let date = null;
  while (parts.length > 1) {
    const last = parts.at(-1).trim();
    const d = last.match(DATE);
    const p = last.match(POINTS);
    const g = last.match(GUESS);
    if (d && !date) {
      date = { label: d[1] ?? null, value: d[2] };
    } else if (MILESTONE.test(last) && !milestone) {
      milestone = last;
    } else if (p && points === null) {
      points = Number(p[1]);
    } else if (g && guess === null) {
      guess = Number(g[1]) * (g[2] === 'h' ? 60 : 1);
    } else if (STAGES.includes(last) && !stage) {
      stage = last;
    } else {
      break;
    }
    parts.pop();
  }
  const head = parts.join(' · ').trim();
  const m = head.match(/^#(\d+)\s+(.*)$/);
  return {
    id: m ? Number(m[1]) : null,
    title: m ? m[2] : head,
    milestone,
    points,
    guess,
    stage,
    date,
    details: [],
  };
}

// How far round the wheel a card is. The lane says most of it: a queued card is still
// being planned, and a card waiting for the user's look is at Feedback. Only a Doing card has
// its stage written on its line; with none written, it is being built. A decision is a
// question and a Done card has left the wheel, so neither has a stage. The one exception
// is a design waiting for the user's yes: it sits with the decisions, marked "design".
export function stageOf(card, column) {
  if (column === 'Ideas' || column === 'Up next') return 'plan';
  if (column === 'Doing') return DOING_STAGES.includes(card.stage) ? card.stage : 'develop';
  if (column === 'Needs your look') return 'feedback';
  return isDesign(card, column) ? 'design' : null;
}

// A card whose design waits for the user's yes before any code is written.
export const isDesign = (card, column) => column === 'Needs your decision' && card.stage === 'design';

// A look dated "from <day>" can't happen before that day (a real space station pass, a
// printer that arrives next week), so until then it isn't waiting on the user. `today` is YYYY-MM-DD.
export const isLater = (card, column, today) =>
  column === 'Needs your look' && card.date?.label === 'from' && card.date.value > today;

// A card reaches the user already tested, with a "tested:" line saying what was checked. The
// check on that line began on this day; looks that went live before it are left alone.
const TESTED_SINCE = '2026-10-03';
const untested = (card, column) =>
  column === 'Needs your look' && !(card.date?.value < TESTED_SINCE) && !card.details.some((d) => d.startsWith('tested:'));

// A card being built, or next up, says what done means (#168). A question (no points) and a
// card in its design stage are left out: their answer is the done.
const noDoneWhen = (card, column) =>
  (column === 'Up next' || column === 'Doing') && card.points !== null && card.stage !== 'design' &&
  !card.details.some((d) => /^done when:/i.test(d));

export function parseBoard(md) {
  const columns = [];
  let nextId = null;
  let card = null;
  for (const line of md.split('\n')) {
    const next = line.match(/<!--\s*next-id:\s*(\d+)\s*-->/);
    if (next) {
      nextId = Number(next[1]);
      continue;
    }
    const heading = line.match(/^## (.+?)\s*$/);
    if (heading) {
      columns.push({ name: heading[1], cards: [] });
      card = null;
      continue;
    }
    const col = columns.at(-1);
    if (!col) continue;
    const item = line.match(/^- (.+)$/);
    if (item) {
      card = parseCardLine(item[1]);
      col.cards.push(card);
    } else if (card && /^\s{2,}\S/.test(line)) {
      card.details.push(line.trim());
    } else if (line.trim()) {
      card = null; // stray text ends the card; blank lines do not
    }
  }
  return { nextId, columns, problems: checkBoard(columns, nextId) };
}

function checkBoard(columns, nextId) {
  const problems = [];
  const names = columns.map((c) => c.name);
  if (names.join('|') !== COLUMNS.join('|')) {
    problems.push(`board.md: columns must be exactly ${COLUMNS.join(', ')} in that order (found: ${names.join(', ') || 'none'})`);
  }
  const seen = new Set();
  let maxId = 0;
  for (const col of columns) {
    for (const c of col.cards) {
      if (c.id === null) {
        problems.push(`board.md: card "${c.title}" has no #id`);
        continue;
      }
      if (seen.has(c.id)) problems.push(`board.md: card #${c.id} appears more than once`);
      seen.add(c.id);
      maxId = Math.max(maxId, c.id);
      if (!c.milestone) problems.push(`board.md: card #${c.id} has no milestone: give it the closest one in plan.md, or add a milestone for it`);
      if (c.stage && !(col.name === 'Doing' && DOING_STAGES.includes(c.stage)) && !isDesign(c, col.name)) {
        problems.push(`board.md: card #${c.id} is marked "${c.stage}"; only a Doing card carries a stage: ${DOING_STAGES.slice(0, -1).join(', ')} or ${DOING_STAGES.at(-1)}`);
      }
      if (noDoneWhen(c, col.name)) problems.push(`board.md: card #${c.id} has no "done when:" line; add one: soloagile card set ${c.id} --done-when "…"`);
      if (untested(c, col.name)) problems.push(`board.md: card #${c.id} waits for the user's look with no "tested:" line; add one saying what was checked`);
      if (c.points !== null && !SCALE.includes(c.points)) {
        problems.push(`board.md: card #${c.id} has ${c.points} pts; use ${SCALE.slice(0, -1).join(', ')} or ${SCALE.at(-1)}`);
      }
    }
  }
  // A finished card keeps one line here; its detail lines belong in the archive (src/archive.js).
  const full = (columns.find((c) => c.name === 'Done')?.cards ?? []).filter((c) => c.details.length).length;
  if (full) {
    problems.push(`board.md: ${full} Done card${full === 1 ? ' still carries its' : 's still carry their'} full text; run \`soloagile archive\` to move it to pm/finished-cards.md`);
  }
  if (nextId === null) {
    problems.push('board.md: missing <!-- next-id: N --> line');
  } else if (nextId <= maxId) {
    problems.push(`board.md: next-id ${nextId} must be above the highest card, #${maxId}`);
  }
  return problems;
}

// "### M1 — The page · in progress" / "### M0 — Convention · done 2026-09-30"
const MILESTONE_HEADING = /^### (M\d+)\s+[—–-]\s+(.+?)\s+·\s+(not started|in progress|done)(?:\s+(\d{4}-\d{2}-\d{2}))?\s*$/;

// A milestone's short name, 2 to 4 words for its chip: "short: Public plugin" under its heading.
export const SHORT_LINE = /^short:\s*(.+?)\s*$/;

// plan.md's "# Heading" is the project's display name ("Plan" means none was given).
export function parsePlan(md) {
  const milestones = [];
  const problems = [];
  const h1 = md.match(/^# (.+?)\s*$/m)?.[1];
  const title = h1 && h1 !== 'Plan' ? h1 : null;
  let inside = null; // the milestone whose text this line is in
  for (const line of md.split('\n')) {
    const short = line.match(SHORT_LINE);
    if (short && inside && !inside.short) inside.short = short[1];
    if (/^#{1,3} /.test(line)) inside = null;
    if (!/^### M\d/.test(line)) continue;
    const h = line.match(MILESTONE_HEADING);
    if (h) {
      inside = { id: h[1], title: h[2], status: h[3], date: h[4] ?? null, short: null };
      milestones.push(inside);
    } else {
      problems.push(`plan.md: milestone heading not understood: "${line}"`);
    }
  }
  return { title, milestones, problems };
}

// A milestone's colour on the page: one of eight, taken in turn by its number, so M9 and
// M17 share one. The class sets --m (template/head.html). A name with no number has none.
export const msClass = (id) => (/^M\d+$/.test(id ?? '') ? `ms-c${Number(id.slice(1)) % 8}` : '');
