// The home page: one list of every card waiting on the user, then one row per project
// that has a page, waiting ones first, and a second tab with the session flow
// (template/flow.md). It covers the projects of one folder, and is written to
// ~/.soloagile/home.html unless the settings say otherwise (src/settings.js).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isLater, parseBoard, parsePlan } from './board.js';
import { buildProject, readProject, readTemplate } from './build.js';
import { parseHistory } from './history.js';
import { icon } from './icons.js';
import { localDate } from './init.js';
import { KIND, ageNote, block, currentMilestone, trustedBlock, esc, inline, kindOf, milestoneInk, stamp } from './page.js';
import { milestonePoints } from './reports.js';
import { homeLink, homePage, stampOf, writeStamp } from './settings.js';

// Folders whose names start with a dot or an underscore are left out, such as an archive.
// A page server should refuse the same ones.
const SERVED = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Rebuilds the page of every project directly under `root`: each folder holding a
// pm/board.md or pm/plan.md, as the hook counts them. After an update, this brings every
// page onto the new version at once. The caller builds the home page after.
export function buildAll(root) {
  const built = [];
  const problems = [];
  for (const folder of readdirSync(root).sort()) {
    const repo = join(root, folder);
    if (!SERVED.test(folder) || !['board.md', 'plan.md'].some((f) => existsSync(join(repo, 'pm', f)))) continue;
    try {
      const r = buildProject(repo);
      built.push(r.out);
      problems.push(...r.problems.map((p) => `${folder}: ${p}`));
    } catch (err) {
      problems.push(`${folder}: not built (${err.message})`);
    }
  }
  return { built, problems };
}

// The cards waiting on the user in one project: decisions first, then the looks that can be done now.
const waitingIn = (board, today) =>
  ['Needs your decision', 'Needs your look'].flatMap((column) =>
    (board.columns.find((c) => c.name === column)?.cards ?? [])
      .filter((card) => !isLater(card, column, today))
      .map((card) => ({ column, id: card.id, title: card.title, kind: kindOf(card, column), age: ageNote(card, column, today) })));

// One summary per folder directly under `root` that has a built page. `today` (YYYY-MM-DD)
// decides which looks can't happen yet; only the tests pass it.
export function listProjects(root, today = localDate()) {
  const projects = [];
  for (const folder of readdirSync(root)) {
    const dir = join(root, folder, 'pm');
    if (!SERVED.test(folder) || !existsSync(join(dir, 'index.html'))) continue;
    const { md } = readProject(join(root, folder));
    const board = parseBoard(md.board);
    const plan = parsePlan(md.plan);
    const current = currentMilestone(plan, board);
    const waiting = waitingIn(board, today);
    const log = join(dir, 'history.md');
    const events = existsSync(log) ? parseHistory(readFileSync(log, 'utf8')) : [];
    projects.push({
      folder,
      href: homeLink(join(root, folder)),
      name: plan.title ?? folder,
      // When its Markdown last changed; the generated page doesn't count.
      updated: Math.max(0, ...readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => statSync(join(dir, f)).mtimeMs)),
      waiting,
      decide: waiting.filter((w) => w.column === 'Needs your decision').length,
      look: waiting.filter((w) => w.column === 'Needs your look').length,
      current: current ? { id: current.id, title: current.title } : null,
      done: plan.milestones.filter((m) => m.status === 'done').length,
      total: plan.milestones.length,
      // The milestone in hand, in story points, and when a card last moved (null with no log).
      points: current ? milestonePoints(events, current.id) : null,
      moved: events.length ? new Date(events.at(-1).at.replace(' ', 'T')).getTime() : null,
    });
  }
  return projects;
}

const waitingOf = (p) => p.decide + p.look;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const countPill = (kind, n) => `<span class="st ${kind.pill}">${icon(kind.icon)}${n} ${kind.label}</span>`;

// A project with no card moved for this many days is flagged Quiet.
const QUIET_DAYS = 7;

// The milestone in hand as a bar: approved in green over built in blue, as on the burn-up.
function renderMeter({ total, built, approved }) {
  const pct = (n) => `${Math.round((n / total) * 1000) / 10}%`;
  return `<div class="meter" role="img" aria-label="${approved} of ${total} points approved, ${built} built"><i class="s-built" style="width:${pct(built)}"></i><i class="s-approved" style="width:${pct(approved)}"></i></div>
<p class="proj-points"><b>${approved}</b> of ${total} points approved · ${built} built</p>`;
}

function renderRow(p, builtAt) {
  const quiet = p.moved ? Math.floor((builtAt - p.moved) / 86400000) : 0;
  const pills = [
    quiet >= QUIET_DAYS ? `<span class="st st-quiet">Quiet ${quiet} days</span>` : '',
    p.decide ? countPill(KIND['Needs your decision'], p.decide) : '',
    p.look ? countPill(KIND['Needs your look'], p.look) : '',
  ].join('');
  const progress = p.total ? `${p.done} of ${p.total} milestones done` : '';
  const milestone = p.current
    ? `${icon('circle-dot')}<span>${milestoneInk(p.current.id)} ${esc(p.current.title)}${progress ? ` · ${progress}` : ''}</span>`
    : p.total
      ? `${icon('check')}<span>Every milestone is done</span>`
      : '';
  return `<li><a class="proj${waitingOf(p) ? ' proj-waiting' : ''}${quiet >= QUIET_DAYS ? ' proj-quiet' : ''}" href="${esc(p.href)}">
<div class="proj-top"><span class="proj-name">${esc(p.name)}</span>${pills ? `<span class="proj-pills">${pills}</span>` : ''}${waitingOf(p) ? '' : '<span class="proj-calm">Nothing waiting</span>'}</div>
${milestone ? `<p class="proj-ms">${milestone}</p>` : ''}
${p.points?.total ? renderMeter(p.points) : ''}
<p class="proj-updated">${icon('clock')}Updated ${esc(stamp(new Date(p.updated)))}</p>
</a></li>`;
}

// Every waiting card from every project in one list, so the user needn't open each page to see
// what needs them. A row links to its project's page.
function renderWaiting(projects) {
  const rows = projects.flatMap((p) => (p.waiting ?? []).map((w) => ({ ...w, p })));
  if (!rows.length) return '';
  const isDecision = (r) => r.column === 'Needs your decision';
  rows.sort((a, b) => isDecision(b) - isDecision(a)); // decisions first; projects keep their order
  const items = rows.map((r) => {
    const k = r.kind;
    return `<li><a class="wait-row card-x card-${k.tone ?? k.label.toLowerCase()}" href="${esc(r.p.href)}"><span class="st ${k.pill}">${icon(k.icon)}${k.label}</span><span class="wait-proj">${esc(r.p.name)}</span>${r.id !== null ? `<span class="card-id">#${r.id}</span>` : ''}<span class="wait-title">${inline(r.title)}</span>${r.age ?? ''}</a></li>`;
  });
  return `<h2 class="sec-h">Waiting on you<span class="lane-count">${rows.length}</span></h2>
<ul class="wait-list">
${items.join('\n')}
</ul>
<h2 class="sec-h">Projects<span class="lane-count">${projects.length}</span></h2>`;
}

const TABS = [
  ['projects', 'Projects', 'layout-dashboard'],
  ['flow', 'Session flow', 'list-todo'],
];

export function renderHome({ projects, builtAt, template, flow = '', stampUrl = '' }) {
  // Anything waiting on the user first, then the most recently updated.
  const sorted = [...projects].sort((a, b) => (waitingOf(b) > 0) - (waitingOf(a) > 0) || b.updated - a.updated);
  const waiting = projects.reduce((n, p) => n + waitingOf(p), 0);
  const parts = {
    summary: `${plural(projects.length, 'project')} · ${waiting ? `<b>${waiting} waiting on you</b>` : 'nothing waiting on you'}`,
    built: `${icon('clock')}Updated ${esc(stamp(builtAt))}`,
    stamp: builtAt.toISOString(),
    stampUrl,
    waiting: renderWaiting(sorted),
    projects: sorted.length ? `<ul class="proj-list">\n${sorted.map((p) => renderRow(p, builtAt)).join('\n')}\n</ul>` : '<p class="empty">No project pages yet.</p>',
    nav: TABS.map(([id, label, ic]) => `<a href="#${id}">${icon(ic)}${label}</a>`).join(''),
    flow: trustedBlock(flow),
  };
  return { html: template.replace(/\{\{(\w+)\}\}/g, (_, key) => parts[key] ?? '') };
}

export function buildHome({ root, out = homePage(), builtAt = new Date() }) {
  const projects = listProjects(root);
  const { html } = renderHome({ projects, builtAt, template: readTemplate('home.html'), flow: readTemplate('flow.md'), stampUrl: stampOf(out).url });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  writeStamp(out, builtAt);
  return { out, count: projects.length };
}
