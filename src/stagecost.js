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
// Two cards run from one session share that session, so its tokens count for both.
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

// Each stage's counts: [{ stage, input_tokens, cache_creation_input_tokens,
// cache_read_input_tokens, output_tokens, minutes }]. Minutes are the sum, over the stage's
// files, of each file's first to last message inside the window.
export function stageCosts(root, id, from, to, options = {}) {
  const files = stageFiles(root, id, from, to, options);
  return STAGES.map((stage) => {
    const row = { stage, minutes: 0, ...Object.fromEntries(USAGE_FIELDS.map((k) => [k, 0])) };
    const seen = new Set();
    for (const file of files[stage]) {
      const msgs = fileUsage(file, from, to);
      const times = [];
      for (const [key, m] of msgs) {
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
export function stageText(id, win, rows) {
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
  ].join('\n');
}

// What `soloagile fleet cost <n>` adds below the run's ## Cost.
export function stageCostText(repo, id, { now = new Date(), projectsDir } = {}) {
  const root = resolve(repo);
  const win = cardWindow(root, id, { now });
  return stageText(id, win, win ? stageCosts(root, id, win.from, win.to, projectsDir ? { projectsDir } : {}) : []);
}
