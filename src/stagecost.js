// A run's tokens and minutes by stage (#297): the main session, Tobin, Milo, Cora and Rufus,
// counted from Claude Code's own logs over the card's time in Doing.
//
// The window runs from the card's move to Doing (pm/runs/<n>/usage-start.json, as
// src/costs.js reads it, or else its first Doing line in pm/history.md) to its first move to
// Needs your look or Done after that, or to now while it is still in Doing. history.md has
// whole minutes, so the end takes in the rest of its minute.
//
// Keeping parallel runs apart: a fleet run's helpers are subagents, each with a sibling
// agent-<id>.meta.json naming its agentType and a description such as "Tobin builds #1733".
// A helper counts for card n when its description names #n (or "card n"), in any project's
// logs, since a run may be driven from another project's session (weatherglider's #1733 was
// run from soloagile's). A helper that names no card counts only from this project's own
// logs. The main session is the session that started the card's helpers; a card with no
// such helper (a normal build) takes this project's own sessions in the window instead.
// Two fleet cards run from one session share that session, so its tokens count for both.
// A normal build (no plan.md) that a main session moved to Needs your look inside the window
// takes that session's turns over its own build time (#306): from its move to Doing, or, with
// none, the board's last move before it landed (buildStart). They are left out here, and
// counted in its own row of pm/runs/costs.md. A fleet card run in a session of its own never
// moves the other card, so nothing is left out.
// Milo's own runs (soloagile fleet milo) are claude -p with --no-session-persistence, so
// they leave no log to count: only a Milo started as a subagent is counted.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { minute, parseHistory } from './history.js';
import { fileUsage, formatTokens, projectSlug, USAGE_FIELDS } from './tokens.js';

export const STAGES = ['main session', 'Tobin', 'Milo', 'Cora', 'Rufus'];
const HELPERS = { 'soloagile:tobin': 'Tobin', 'soloagile:milo': 'Milo', 'soloagile:cora': 'Cora', 'soloagile:rufus': 'Rufus' };

const defaultDir = () => process.env.SOLOAGILE_CLAUDE_PROJECTS || join(homedir(), '.claude', 'projects');
const local = (at) => new Date(at.replace(' ', 'T')).getTime(); // a history.md minute, local time
const LANDED = ['Needs your look', 'Done'];
const readEvents = (root) => { try { return parseHistory(readFileSync(join(root, 'pm', 'history.md'), 'utf8')); } catch { return []; } };
const isFleet = (root, id) => existsSync(join(root, 'pm', 'runs', String(id), 'plan.md'));

// When card id's build began, for a landing at `at` (ms): its usage-start.json time, else its
// own last move before the landing's minute if that was to Doing, else (a card that went to
// Needs your look with no Doing move, as weatherglider's #1738 and #1759 did beside the fleet's
// #1705) the board's last move of any card before that minute. null when there is none.
export function buildStart(root, id, at, events = readEvents(root)) {
  try {
    const from = Date.parse(JSON.parse(readFileSync(join(root, 'pm', 'runs', String(id), 'usage-start.json'), 'utf8')).at);
    if (Number.isFinite(from)) return from;
  } catch {}
  const before = events.filter((e) => local(e.at) < local(minute(new Date(at))));
  const own = before.filter((e) => e.id === id).at(-1);
  if (own?.lane === 'Doing') return local(own.at);
  return before.length ? local(before.at(-1).at) : null;
}

// Did this session file run `soloagile card move <id> …`?
function moved(file, id) {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return false; }
  const re = new RegExp(`card move #?${id}(?!\\d)`);
  return text.split('\n').some((l) => l.includes('"tool_use"') && re.test(l));
}

// Card id's window: { from, to, open } in ms, open when it is still in Doing; null when the
// card never went into Doing.
export function cardWindow(repo, id, { now = new Date() } = {}) {
  const root = resolve(repo);
  let events = [];
  try { events = parseHistory(readFileSync(join(root, 'pm', 'history.md'), 'utf8')).filter((e) => e.id === id); } catch {}
  let from = NaN;
  try { from = Date.parse(JSON.parse(readFileSync(join(root, 'pm', 'runs', String(id), 'usage-start.json'), 'utf8')).at); } catch {}
  if (!Number.isFinite(from)) {
    const doing = events.find((e) => e.lane === 'Doing');
    if (!doing) return null;
    from = local(doing.at);
  }
  const startMinute = local(minute(new Date(from)));
  const landed = events.find((e) => (e.lane === 'Needs your look' || e.lane === 'Done') && local(e.at) >= startMinute);
  return landed ? { from, to: local(landed.at) + 59999, open: false } : { from, to: now.getTime(), open: true };
}

// Card numbers a helper's description names: "Tobin builds #1733", "card 270".
const namedCards = (text) => [...String(text ?? '').matchAll(/(?:#|\bcard\s+)(\d+)\b/gi)].map((m) => Number(m[1]));

const list = (dir) => { try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
const fresh = (path, since) => { try { return statSync(path).mtimeMs >= since; } catch { return false; } };

// The log files of each stage for card id in [from, to]: { 'main session': [paths], Tobin: […], … }.
export function stageFiles(root, id, from, to, { projectsDir = defaultDir() } = {}) {
  const slug = projectSlug(root);
  const own = (d) => d === slug || d.startsWith(`${slug}--claude-worktrees-`);
  const files = Object.fromEntries(STAGES.map((s) => [s, []]));
  const drivers = new Set();
  for (const d of list(projectsDir).filter((e) => e.isDirectory())) {
    for (const s of list(join(projectsDir, d.name)).filter((e) => e.isDirectory())) {
      const sub = join(projectsDir, d.name, s.name, 'subagents');
      for (const f of list(sub).filter((e) => e.name.endsWith('.meta.json'))) {
        const log = join(sub, f.name.replace(/\.meta\.json$/, '.jsonl'));
        if (!fresh(log, from)) continue;
        let meta;
        try { meta = JSON.parse(readFileSync(join(sub, f.name), 'utf8')); } catch { continue; }
        const stage = HELPERS[meta?.agentType];
        if (!stage) continue;
        const named = namedCards(meta.description);
        if (named.includes(id)) drivers.add(join(projectsDir, d.name, `${s.name}.jsonl`));
        else if (named.length || !own(d.name)) continue;
        files[stage].push(log);
      }
    }
  }
  if (drivers.size) files['main session'] = [...drivers].filter(existsSync);
  else {
    for (const d of list(projectsDir).filter((e) => e.isDirectory() && own(e.name))) {
      for (const f of list(join(projectsDir, d.name)).filter((e) => e.isFile() && e.name.endsWith('.jsonl'))) {
        const path = join(projectsDir, d.name, f.name);
        if (fresh(path, from)) files['main session'].push(path);
      }
    }
  }
  return files;
}

// The normal builds a main session did inside card id's window [from, to]: { file: [[from,
// to], …] }, for each card with no plan.md that landed in the window, moved there by that file.
export function otherBuilds(root, id, from, to, files, events = readEvents(root)) {
  const spans = {};
  const done = new Set([id]);
  events.forEach((e, i) => {
    if (done.has(e.id) || !LANDED.includes(e.lane) || local(e.at) < local(minute(new Date(from))) || local(e.at) > to) return;
    const prev = events.slice(0, i).filter((p) => p.id === e.id).at(-1);
    if (prev && LANDED.includes(prev.lane)) return; // look to Done is no new build
    done.add(e.id);
    if (isFleet(root, e.id)) return;
    const start = buildStart(root, e.id, local(e.at), events);
    if (start == null) return;
    for (const f of files) if (moved(f, e.id)) (spans[f] ??= []).push({ id: e.id, from: start, to: local(e.at) + 59999 });
  });
  return spans;
}

// The tokens of card id's build, for its row in pm/runs/costs.md (#306): this project's logs
// (its fleet copies and helpers too) between from and to, each message once, leaving out
// another card's fleet run: a fleet copy named card-<other>, a helper naming only other cards,
// and the session that started such a helper, unless that session moved card id itself.
// null when the project has no log folder.
export function buildTokens(root, id, from, to, { projectsDir = defaultDir() } = {}) {
  const slug = projectSlug(root);
  const dirs = list(projectsDir).filter((e) => e.isDirectory() && (e.name === slug || e.name.startsWith(`${slug}--claude-worktrees-`)));
  if (!dirs.some((d) => d.name === slug)) return null;
  const msgs = new Map();
  for (const d of dirs) {
    const copy = d.name.match(/--claude-worktrees-card-(\d+)$/);
    if (copy && Number(copy[1]) !== id) continue;
    const dir = join(projectsDir, d.name);
    const skip = new Set();
    for (const s of list(dir).filter((e) => e.isDirectory())) {
      const sub = join(dir, s.name, 'subagents');
      const driver = join(dir, `${s.name}.jsonl`);
      for (const f of list(sub).filter((e) => e.name.endsWith('.meta.json'))) {
        let meta;
        try { meta = JSON.parse(readFileSync(join(sub, f.name), 'utf8')); } catch { continue; }
        const named = namedCards(meta?.description);
        if (!HELPERS[meta?.agentType] || !named.length || named.includes(id)) continue;
        skip.add(join(sub, f.name.replace(/\.meta\.json$/, '.jsonl')));
        if (!skip.has(join(dir, s.name)) && fresh(driver, from) && !moved(driver, id)) { skip.add(driver); skip.add(join(dir, s.name)); }
      }
    }
    const walk = (p) => {
      if (skip.has(p)) return;
      for (const e of list(p)) {
        const q = join(p, e.name);
        if (e.isDirectory()) walk(q);
        else if (e.name.endsWith('.jsonl') && !skip.has(q) && fresh(q, from)) for (const [k, m] of fileUsage(q, from, to)) msgs.set(k, m.tokens);
      }
    };
    walk(dir);
  }
  let total = 0;
  for (const n of msgs.values()) total += n;
  return total;
}

// Each stage's counts: [{ stage, input_tokens, cache_creation_input_tokens,
// cache_read_input_tokens, output_tokens, minutes }]. Minutes are the sum, over the stage's
// files, of each file's first to last message inside the window.
// The main session leaves out turns inside options.others (otherBuilds' spans, worked out
// here when not given).
export function stageCosts(root, id, from, to, options = {}) {
  const files = stageFiles(root, id, from, to, options);
  const others = options.others ?? otherBuilds(root, id, from, to, files['main session']);
  return STAGES.map((stage) => {
    const row = { stage, minutes: 0, ...Object.fromEntries(USAGE_FIELDS.map((k) => [k, 0])) };
    const seen = new Set();
    for (const file of files[stage]) {
      const msgs = fileUsage(file, from, to);
      const times = [];
      const out = stage === 'main session' ? others[file] ?? [] : [];
      for (const [key, m] of msgs) {
        if (out.some((o) => m.at >= o.from && m.at <= o.to)) continue;
        times.push(m.at);
        if (seen.has(key)) continue;
        seen.add(key);
        for (const k of USAGE_FIELDS) row[k] += m.usage[k];
      }
      if (times.length) row.minutes += (Math.max(...times) - Math.min(...times)) / 60000;
    }
    return row;
  });
}

const HEAD = ['Stage', 'Input', 'Cache writes', 'Cache reads', 'Output', 'Total', 'Minutes'];

// The table: one row per stage and a total, tokens as formatTokens writes them.
// others: otherBuilds' spans, named in a footnote when there are any.
export function stageText(id, win, rows, others = {}) {
  if (!win) return `soloagile: #${id} never went into Doing, so it has no run to count`;
  const total = { stage: 'total', minutes: 0, ...Object.fromEntries(USAGE_FIELDS.map((k) => [k, 0])) };
  for (const r of rows) for (const k of [...USAGE_FIELDS, 'minutes']) total[k] += r[k];
  const cells = (r) => [r.stage, ...USAGE_FIELDS.map((k) => formatTokens(r[k])),
    formatTokens(USAGE_FIELDS.reduce((sum, k) => sum + r[k], 0)), String(Math.round(r.minutes))];
  const table = [HEAD, ...rows.map(cells), cells(total)];
  const widths = HEAD.map((_, i) => Math.max(...table.map((t) => t[i].length)));
  const line = (t) => t.map((c, i) => (i ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  ').trimEnd();
  const end = win.open ? 'now (still in Doing)' : minute(new Date(win.to));
  return [
    `## By stage`,
    `#${id} from ${minute(new Date(win.from))} to ${end}, from Claude Code's logs:`,
    '',
    ...table.map(line),
    '',
    "Milo's own runs (soloagile fleet milo) keep no log, so only a Milo started as a helper is counted.",
    ...leftOut(others),
  ].join('\n');
}

// The footnote for the main session's left-out turns: one line per normal build.
function leftOut(others) {
  const spans = new Map();
  for (const got of Object.values(others)) for (const o of got) spans.set(o.id, o);
  if (!spans.size) return [];
  const hm = (ms) => minute(new Date(ms)).slice(11);
  return [
    'The main session leaves out its turns while it built these cards normally (from their move to',
    "Doing, or with none the board's last move before it, to their landing); each has its own row in pm/runs/costs.md:",
    ...[...spans.values()].map((o) => `- #${o.id}, ${hm(o.from)} to ${hm(o.to)}`),
  ];
}

// What `soloagile fleet cost <n>` adds below the run's ## Cost.
export function stageCostText(repo, id, { now = new Date(), projectsDir } = {}) {
  const root = resolve(repo);
  const win = cardWindow(root, id, { now });
  if (!win) return stageText(id, win, []);
  const opts = projectsDir ? { projectsDir } : {};
  const others = otherBuilds(root, id, win.from, win.to, stageFiles(root, id, win.from, win.to, opts)['main session']);
  return stageText(id, win, stageCosts(root, id, win.from, win.to, { ...opts, others }), others);
}
