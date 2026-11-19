// What a card cost to build, fleet run or normal build, measured the same way (#280).
// `soloagile card move <n> doing` records the usage reading at the start (pm/runs/<n>/
// usage-start.json, as fleet preflight does), and `card move <n> look` takes the end reading
// and writes the card's row here. pm/runs/costs.md holds one row per card and a table by
// size that sets the fleet's runs beside normal builds of the same points.
// The readings are the account's whole use, so anything else running at the time counts too.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseBoard } from './board.js';
import { localDate } from './init.js';

const HEAD = `# What cards cost

Each card's share of the week and the 5 hours, from the usage reading when it moved to Doing
to the one when it moved to Needs your look. A fleet card is one with a plan.md in its run.
The readings are the account's whole use, so anything else running at the time counts too.

`;

const pct = (x) => `${x.toFixed(1)}%`;

// Rows already in the file: [{ id, points, how, week, five, date }].
function readRows(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n')
    .map((line) => line.match(/^\| #(\d+) \| (\d+|–) \| (fleet|normal) \| ([\d.]+%|–) \| ([\d.]+%|–) \| ([\d-]+) \|$/))
    .filter(Boolean)
    .map(([, id, points, how, week, five, date]) => ({ id: Number(id), points, how, week, five, date }));
}

function render(rows) {
  const byCard = rows.slice().sort((a, b) => a.id - b.id)
    .map((r) => `| #${r.id} | ${r.points} | ${r.how} | ${r.week} | ${r.five} | ${r.date} |`);
  const sizes = [...new Set(rows.map((r) => r.points))].sort((a, b) => Number(a) - Number(b));
  const side = (size, how, word) => {
    const got = rows.filter((r) => r.points === size && r.how === how && r.five !== '–');
    if (!got.length) return 'none yet';
    const avg = got.reduce((sum, r) => sum + parseFloat(r.five), 0) / got.length;
    return `${got.length} ${word}${got.length === 1 ? '' : 's'}, ${pct(avg)} of the 5 hours`;
  };
  const bySize = sizes.map((size) => `| ${size} | ${side(size, 'fleet', 'run')} | ${side(size, 'normal', 'build')} |`);
  return `${HEAD}## By size, on average

| Points | Fleet runs | Normal builds |
|---|---|---|
${bySize.join('\n')}

## Each card

| Card | Points | How | Week | 5 hours | Date |
|---|---|---|---|---|---|
${byCard.join('\n')}
`;
}

// Writes card id's row from its start reading and `end` (readUsage's result). Returns false,
// writing nothing, when either reading has no numbers. A card logged again replaces its row.
export function logCost(repo, id, end, { now = new Date() } = {}) {
  const root = resolve(repo);
  const run = join(root, 'pm', 'runs', String(id));
  let start = null;
  try { start = JSON.parse(readFileSync(join(run, 'usage-start.json'), 'utf8')); } catch { return false; }
  if (!start?.pcts || !end?.pcts) return false;
  const spent = (name) => {
    const from = start.pcts[name];
    const to = end.pcts[name];
    // a window that reset during the build reads lower at the end: not measured
    return Number.isFinite(from) && Number.isFinite(to) && to >= from ? pct(to - from) : '–';
  };
  const week = spent('week');
  const five = spent('5 hours');
  if (week === '–' && five === '–') return false;
  let board = '';
  try { board = readFileSync(join(root, 'pm', 'board.md'), 'utf8'); } catch {}
  const card = parseBoard(board).columns.flatMap((c) => c.cards).find((c) => c.id === id);
  const row = {
    id,
    points: card?.points != null ? String(card.points) : '–',
    how: existsSync(join(run, 'plan.md')) ? 'fleet' : 'normal',
    week,
    five,
    date: localDate(now),
  };
  const file = join(root, 'pm', 'runs', 'costs.md');
  const rows = readRows(file).filter((r) => r.id !== id).concat(row);
  mkdirSync(join(root, 'pm', 'runs'), { recursive: true });
  writeFileSync(file, render(rows));
  return true;
}
