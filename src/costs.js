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
import { formatTokens, projectTokens } from './tokens.js';

const HEAD = `# What cards cost

Each card's share of the week and the 5 hours, from the usage reading when it moved to Doing
to the one when it moved to Needs your look. A fleet card is one with a plan.md in its run.
The readings are the account's whole use, so anything else running at the time counts too.
The percentages are whole numbers at their source; Tokens is exact, counted from this
project's own Claude Code logs (its fleet copies and helpers too) over the same time.

`;

const pct = (x) => `${x.toFixed(1)}%`;

// Rows already in the file: [{ id, points, how, week, five, tokens, date }]. A row from
// before #286 has no Tokens column and reads '–'.
function readRows(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n')
    .map((line) => line.match(/^\| #(\d+) \| (\d+|–) \| (fleet|normal) \| ([\d.]+%|–) \| ([\d.]+%|–) \| (?:([\d.]+[kMB]?|–) \| )?([\d-]+) \|$/))
    .filter(Boolean)
    .map(([, id, points, how, week, five, tokens, date]) => ({ id: Number(id), points, how, week, five, tokens: tokens ?? '–', date }));
}

// "1.2M" back to a number, for the averages
const tokenCount = (s) => {
  const m = String(s).match(/^([\d.]+)([kMB]?)$/);
  return m ? Number(m[1]) * ({ '': 1, k: 1e3, M: 1e6, B: 1e9 })[m[2]] : null;
};

function render(rows) {
  const byCard = rows.slice().sort((a, b) => a.id - b.id)
    .map((r) => `| #${r.id} | ${r.points} | ${r.how} | ${r.week} | ${r.five} | ${r.tokens} | ${r.date} |`);
  const sizes = [...new Set(rows.map((r) => r.points))].sort((a, b) => Number(a) - Number(b));
  const side = (size, how, word) => {
    const got = rows.filter((r) => r.points === size && r.how === how && r.five !== '–');
    if (!got.length) return 'none yet';
    const avg = got.reduce((sum, r) => sum + parseFloat(r.five), 0) / got.length;
    const counted = got.map((r) => tokenCount(r.tokens)).filter((n) => n != null);
    const tokens = counted.length ? `, ${formatTokens(Math.round(counted.reduce((a, b) => a + b, 0) / counted.length))} tokens` : '';
    return `${got.length} ${word}${got.length === 1 ? '' : 's'}, ${pct(avg)} of the 5 hours${tokens}`;
  };
  const bySize = sizes.map((size) => `| ${size} | ${side(size, 'fleet', 'run')} | ${side(size, 'normal', 'build')} |`);
  return `${HEAD}## By size, on average

| Points | Fleet runs | Normal builds |
|---|---|---|
${bySize.join('\n')}

## Each card

| Card | Points | How | Week | 5 hours | Tokens | Date |
|---|---|---|---|---|---|---|
${byCard.join('\n')}
`;
}

// Writes card id's row from its start reading and `end` (readUsage's result). Returns false,
// writing nothing, when either reading has no numbers. A card logged again replaces its row.
export function logCost(repo, id, end, { now = new Date(), projectsDir } = {}) {
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
    tokens: tokensSince(root, start.at, now, projectsDir),
    date: localDate(now),
  };
  const file = join(root, 'pm', 'runs', 'costs.md');
  const rows = readRows(file).filter((r) => r.id !== id).concat(row);
  mkdirSync(join(root, 'pm', 'runs'), { recursive: true });
  writeFileSync(file, render(rows));
  return true;
}

// The project's tokens from a start time to now, formatted, or '–' when they can't be read.
export function tokensSince(root, at, now, projectsDir) {
  const from = Date.parse(at);
  if (!Number.isFinite(from)) return '–';
  const n = projectTokens(root, from, now.getTime(), projectsDir ? { projectsDir } : {});
  return n == null ? '–' : formatTokens(n);
}
