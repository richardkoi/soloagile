import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import './isolate.js';
import { readTemplate } from '../src/build.js';
import { buildHome, listProjects, renderHome } from '../src/home.js';
import { runHook } from '../src/hook.js';

const template = readTemplate('home.html');
const builtAt = new Date(2026, 8, 30, 15, 4);

// A board with the given card ids waiting for a decision and for a look.
const board = ({ decide = [], look = [] } = {}) => `# Board
<!-- next-id: 90 -->
## Ideas
## Up next
## Doing
## Needs your look
${look.map((id) => `- #${id} Check it · M1`).join('\n')}
## Needs your decision
${decide.map((id) => `- #${id} Which one? · M1`).join('\n')}
## Done
`;

const plan = `# Alpha Tool
### M0 — Start · done 2026-09-01
### M1 — Page · done 2026-09-02
### M2 — Home · in progress
### M3 — Phone · not started
### M4 — Pilot · not started
`;

// Adds <root>/<folder>/pm/ with the given files, all dated `age` seconds from now.
function addProject(root, folder, files, age = 0) {
  const dir = join(root, folder, 'pm');
  mkdirSync(dir, { recursive: true });
  const t = Date.now() / 1000 + age;
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text);
    utimesSync(join(dir, name), t, t);
  }
}

const root = () => mkdtempSync(join(tmpdir(), 'pm-home-'));

// A summary as listProjects returns it, for the pure render tests.
const summary = (folder, over = {}) => ({
  folder, href: `/${folder}/`, name: folder, updated: Date.now(), decide: 0, look: 0, current: null, done: 0, total: 0, ...over,
});

test('lists only project folders that have a page', () => {
  const r = root();
  addProject(r, 'alpha', { 'board.md': board(), 'index.html': 'page' });
  addProject(r, '_archived', { 'board.md': board(), 'index.html': 'page' });
  addProject(r, '.hidden', { 'board.md': board(), 'index.html': 'page' });
  addProject(r, 'no-page-yet', { 'board.md': board() });
  mkdirSync(join(r, 'plain'));
  writeFileSync(join(r, 'notes.md'), 'a file, not a project');
  assert.deepEqual(listProjects(r).map((p) => p.folder), ['alpha']);
});

test('a summary has the name, current milestone, progress and waiting counts', () => {
  const r = root();
  addProject(r, 'alpha', { 'board.md': board({ decide: [1], look: [2, 3] }), 'plan.md': plan, 'index.html': 'page' }, -3600);
  const [p] = listProjects(r);
  assert.equal(p.name, 'Alpha Tool');
  assert.deepEqual(p.current, { id: 'M2', title: 'Home' });
  assert.equal(p.done, 2);
  assert.equal(p.total, 5);
  assert.equal(p.decide, 1);
  assert.equal(p.look, 2);
  assert.ok(Math.abs(p.updated - (Date.now() - 3600_000)) < 5000, 'updated is when its Markdown last changed');
});

test('the milestone in hand is the one whose cards are moving', () => {
  const r = root();
  const moving = board({ look: [2] }).replace('## Doing\n', '## Doing\n- #7 Build it · M3 · 3 pts · develop\n');
  addProject(r, 'alpha', { 'board.md': moving, 'plan.md': plan, 'index.html': 'page' });
  assert.deepEqual(listProjects(r)[0].current, { id: 'M3', title: 'Phone' });
});

test("a look that can't happen yet isn't counted", () => {
  const r = root();
  const later = board({ look: [2] }).replace('- #2 Check it · M1', '- #2 Check it · M1 · from 2026-10-05\n- #3 Check that · M1 · from 2026-10-01');
  addProject(r, 'alpha', { 'board.md': later, 'index.html': 'page' });
  assert.equal(listProjects(r, '2026-10-02')[0].look, 1);
});

test('without a plan heading the folder name is used', () => {
  const r = root();
  addProject(r, 'beta', { 'board.md': board(), 'index.html': 'page' });
  assert.equal(listProjects(r)[0].name, 'beta');
});

test('anything waiting on the user comes first, then the most recently updated', () => {
  const now = Date.now();
  const projects = [
    summary('calm-new', { updated: now }),
    summary('waiting-old', { updated: now - 9000, look: 1 }),
    summary('calm-old', { updated: now - 5000 }),
    summary('waiting-new', { updated: now - 1000, decide: 1 }),
  ];
  const { html } = renderHome({ projects, builtAt, template });
  const order = ['waiting-new', 'waiting-old', 'calm-new', 'calm-old'].map((f) => html.indexOf(`href="/${f}/"`));
  assert.ok(order.every((i) => i > 0), 'every project is linked');
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('a row shows the milestone, progress and separate decide and look counts', () => {
  const p = summary('alpha', { name: 'Alpha Tool', decide: 1, look: 2, current: { id: 'M2', title: 'Home' }, done: 2, total: 5 });
  const { html } = renderHome({ projects: [p], builtAt, template });
  assert.match(html, /<a class="proj proj-waiting" href="\/alpha\/">/);
  assert.match(html, /Alpha Tool/);
  assert.match(html, /<b class="ms-ink ms-c2">M2<\/b> Home/);
  assert.match(html, /2 of 5/);
  assert.match(html, /1 Decide/);
  assert.match(html, /2 Look/);
  assert.match(html, /1 project · <b>3 waiting on you<\/b>/);
});

test('a project with nothing waiting says so, without the amber rail', () => {
  const { html } = renderHome({ projects: [summary('calm')], builtAt, template });
  assert.match(html, /<a class="proj" href="\/calm\/">/);
  assert.match(html, /Nothing waiting/);
  assert.match(html, /1 project · nothing waiting on you/);
});

test('one list shows every card waiting on the user, decisions first, each linking to its project', () => {
  const r = root();
  addProject(r, 'alpha', { 'board.md': board({ look: [2] }), 'plan.md': plan, 'index.html': 'page' });
  addProject(r, 'beta', { 'board.md': board({ decide: [7] }).replace('Which one? · M1', 'Which one? · M1 · asked 2026-09-27'), 'index.html': 'page' });
  const { html } = renderHome({ projects: listProjects(r, '2026-09-30'), builtAt, template });
  const list = html.match(/<ul class="wait-list">[^]*?<\/ul>/)[0];
  assert.match(list, /<a class="wait-row card-x card-decide" href="\/beta\/">.*Decide<\/span><span class="wait-proj">beta<\/span><span class="card-id">#7<\/span><span class="wait-title">Which one\?<\/span><span class="age" data-since="2026-09-27">waiting 3 days<\/span><\/a>/);
  assert.match(list, /<a class="wait-row card-x card-look" href="\/alpha\/">.*Look<\/span><span class="wait-proj">Alpha Tool<\/span><span class="card-id">#2<\/span><span class="wait-title">Check it<\/span>/);
  assert.ok(list.indexOf('#7') < list.indexOf('#2'), 'decisions come before looks');
  addProject(r, 'gamma', { 'board.md': board({ decide: [9] }).replace('- #9 Which one? · M1', '- #9 Stage strip · M1 · 5 pts · design'), 'index.html': 'page' });
  assert.match(renderHome({ projects: listProjects(r), builtAt, template }).html, /<a class="wait-row card-x card-decide" href="\/gamma\/">.*<\/svg>Design<\/span><span class="wait-proj">gamma<\/span>/, 'a design waiting for his yes says Design');
  assert.match(html, /Waiting on you<span class="lane-count">2<\/span>/);
});

test('with nothing waiting, the list is left out', () => {
  const { html } = renderHome({ projects: [summary('calm')], builtAt, template });
  assert.doesNotMatch(html, /class="wait-list"/);
  assert.doesNotMatch(html, /class="sec-h"/);
});

test('names from the Markdown are escaped', () => {
  const { html } = renderHome({ projects: [summary('x', { name: '<b>x</b>' })], builtAt, template });
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
});

test('with no pages it says so', () => {
  const { html } = renderHome({ projects: [], builtAt, template });
  assert.match(html, /No project pages yet\./);
  assert.match(html, /0 projects · nothing waiting on you/);
});

test('the home page has the shared styles, theme toggle and live refresh', () => {
  const { html } = renderHome({ projects: [], builtAt, template });
  assert.match(html, /<title>Projects - PM<\/title>/);
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/);
  assert.doesNotMatch(html, /\{\{/);
  assert.match(html, /--bg-canvas/);
  assert.match(html, /toggleTheme\(\)/);
  assert.match(html, /Live refresh/);
});

test('buildHome writes the page listing every project', () => {
  const r = root();
  addProject(r, 'alpha', { 'board.md': board(), 'index.html': 'page' });
  const out = join(root(), 'home', 'index.html');
  assert.equal(buildHome({ root: r, out, builtAt }).count, 1);
  assert.match(readFileSync(out, 'utf8'), /href="\/alpha\/"/);
});

test('the hook rebuilds the home page after rebuilding a project under the projects folder', () => {
  const r = root();
  addProject(r, 'alpha', { 'board.md': board() });
  const out = join(root(), 'index.html');
  runHook({ cwd: join(r, 'alpha') }, { root: r, out });
  assert.match(readFileSync(out, 'utf8'), /href="\/alpha\/"/);
});

test('a project outside the projects folder leaves the home page alone', () => {
  const r = root();
  const elsewhere = root();
  addProject(elsewhere, 'stray', { 'board.md': board() });
  const out = join(root(), 'index.html');
  runHook({ cwd: join(elsewhere, 'stray') }, { root: r, out });
  assert.equal(existsSync(out), false);
});

test('the home page has a Session flow tab beside the projects', () => {
  const { html } = renderHome({ projects: [], builtAt, template, flow: '## A session\n\n1. **Start.** Type `work`.\n' });
  assert.match(html, /<a href="#projects">.*Projects<\/a><a href="#flow">.*Session flow<\/a>/s);
  assert.match(html, /<section class="tab tab-flow"[^>]*><div class="panel-x md-prose">\s*<h2[^>]*>A session<\/h2>/);
  assert.match(html, /<li><strong>Start\.<\/strong> Type <code>work<\/code>\.<\/li>/);
});

test('the real flow page opens with the wheel: six stages, each with its bar', () => {
  const { html } = renderHome({ projects: [], builtAt, template, flow: readTemplate('flow.md') });
  const wheel = html.match(/<ol class="wheel">[^]*?<\/ol>/)[0];
  const tiles = [...wheel.matchAll(/<li>(.*)<\/li>/g)].map((m) => m[1]);
  assert.deepEqual(tiles.map((t) => t.match(/<b>(\w+)<\/b>/)[1]), ['Plan', 'Design', 'Develop', 'Test', 'Release', 'Feedback']);
  assert.deepEqual(tiles.map((t) => t.match(/<i class="on"><\/i>/g).length), [1, 2, 3, 4, 5, 6], 'each bar is filled up to its stage');
  assert.ok(html.indexOf('class="wheel"') < html.indexOf('A session, start to finish'), 'the wheel comes first');
  assert.match(html, /ol\.wheel \{/);
});

test('the real flow page names every session command', () => {
  const flow = readTemplate('flow.md');
  for (const words of ['/soloagile:catchup', '/soloagile:commit', '/soloagile:save', '/soloagile:needs', '/soloagile:retro', '/soloagile:init', 'what needs me', 'catch me up', '"commit"', '"deploy"', 'ship it', 'done for today']) assert.ok(flow.includes(words), words);
});

test('a row shows the milestone in hand as a bar of story points', () => {
  const r = root();
  const history = [
    '- 2026-09-30 09:00 · Done · #1 Old work · M1 · 8 pts',
    '- 2026-09-30 10:00 · Done · #2 A · M2 · 3 pts',
    '- 2026-09-30 11:00 · Needs your look · #3 B · M2 · 5 pts',
    '- 2026-09-30 12:00 · Up next · #4 C · M2 · 2 pts',
  ].join('\n');
  addProject(r, 'alpha', { 'board.md': board({ look: [3] }), 'plan.md': plan, 'history.md': history, 'index.html': 'page' });
  const [p] = listProjects(r);
  assert.deepEqual(p.points, { total: 10, built: 8, approved: 3 });
  const { html } = renderHome({ projects: [p], builtAt, template });
  assert.match(html, /aria-label="3 of 10 points approved, 8 built"/);
  assert.match(html, /<i class="s-built" style="width:80%"><\/i><i class="s-approved" style="width:30%"><\/i>/);
  assert.match(html, /<b>3<\/b> of 10 points approved · 8 built/);
});

test('a project with no card moved for a week is flagged Quiet; a busy or unlogged one is not', () => {
  const day = 86400000;
  const row = (over) => renderHome({ projects: [summary('alpha', over)], builtAt, template }).html;
  assert.match(row({ moved: builtAt - 9 * day }), /class="proj proj-quiet"[\s\S]*Quiet 9 days/);
  assert.doesNotMatch(row({ moved: builtAt - 6 * day }), /Quiet \d/);
  assert.doesNotMatch(row({ moved: null }), /Quiet \d/);
  assert.doesNotMatch(row({ moved: builtAt - day }), /class="meter"/, 'no bar without points');
});

test('the home page has the same "?" and command guide as a project page', () => {
  const { html } = renderHome({ projects: [], builtAt, template });
  assert.match(html, /<button class="btn btn-ghost help" type="button" popovertarget="guide"/);
  assert.equal(html.match(/<div class="card-modal guide" id="guide" popover[^]*?<\/ul>/)[0],
    readTemplate('page.html').match(/<div class="card-modal guide" id="guide" popover[^]*?<\/ul>/)[0]);
});
