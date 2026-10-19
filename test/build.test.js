import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';
import { buildProject, readProject, readTemplate } from '../src/build.js';
import { linkIcon, renderPage, shortDate } from '../src/page.js';
import { msClass } from '../src/board.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const template = readTemplate('page.html');
const builtAt = new Date(2026, 8, 30, 15, 4);

const md = {
  board: `# Board
<!-- next-id: 4 -->
## Ideas
## Up next
- #1 Write \`soloagile build\` · M1
## Doing
## Needs your look
- #2 Check the page · M1 · built 2026-09-30
## Needs your decision
- #3 Push to GitHub? · M1 · asked 2026-09-30
## Done
`,
  plan: `# Plan
### M0 — Convention · done 2026-09-30
### M1 — The page · in progress
`,
  releases: '',
  overview: '# Overview\nLiteral {{board}} stays as written.\n',
  decisions: '# Decisions\n## 2026-09-30 · Links?\n**Answer:** yes\n',
  links: '# Links\n- [Site](https://example.com) · added 2026-09-30\n- [Page](file:///tmp/x.html)\n',
};

test('renders every tab, the cards and the header summary', () => {
  const { html, problems } = renderPage({ name: 'demo', md, builtAt, template });
  assert.deepEqual(problems, []);
  for (const tab of ['board', 'plan', 'reports', 'releases', 'docs', 'links']) {
    assert.match(html, new RegExp(`id="${tab}" class="anchor"`));
    assert.match(html, new RegExp(`class="tab tab-${tab}"`));
  }
  assert.match(html, /Write <code>soloagile build<\/code>/);
  assert.match(html, /<span class="lane-name">Waiting on you<\/span><span class="lane-count">2<\/span>/);
  assert.match(html, /<span class="badge" aria-label="2 waiting on you">2<\/span>/);
  assert.match(html, /Working on <b class="ms-ink ms-c1">M1<\/b> The page/);
  assert.doesNotMatch(html, /title="M0: Convention/, 'a done milestone leaves the top row');
  assert.match(html, /<li><a class="st st-go ms-done" href="#plan" title="1 milestone done: see the plan"><svg[^>]*>.*?<\/svg>1 done<\/a><\/li><\/ol>/);
  assert.match(html, /<li class="st st-open ms-current ms-c1" title="M1: The page, in progress">/);
  assert.match(html, /Updated 30 Sep, 15:04/);
  assert.match(html, /No releases yet/);
  assert.match(html, /<h2 class="md-sec h-icon"><svg[^]*?<\/svg>Decisions<\/h2>/);
});

test('decisions come before looks in Waiting on you', () => {
  const { html } = renderPage({ name: 'demo', md, builtAt, template });
  assert.ok(html.indexOf('Push to GitHub?') < html.indexOf('Check the page'));
  assert.match(html, /<span class="st st-hold"><svg[^]*?<\/svg>Decide<\/span>/);
  assert.match(html, /<span class="st st-look"><svg[^]*?<\/svg>Look<\/span>/);
  assert.match(html, /Asked 30 Sep/);
});

test('each card is shaded by its lane', () => {
  const { html } = renderPage({ name: 'demo', md, builtAt, template });
  assert.match(html, /<li class="card-x card-decide">.*Push to GitHub\?/);
  assert.match(html, /<li class="card-x card-look">.*Check the page/);
  assert.match(html, /<li class="card-x card-up-next">.*soloagile build/);
});

const withCards = (lines) => ({ ...md, board: md.board.replace('## Doing\n', `## Doing\n${lines}`) });

test('a card shows one short line, and its full description in a modal', () => {
  const board = withCards('- #7 Long card · M1\n  the short line\n  a much longer second line\n  see https://example.com/x\n');
  const { html } = renderPage({ name: 'demo', md: board, builtAt, template });
  const card = html.match(/<li class="card-x card-doing">.*Long card.*<\/li>/)[0];
  const [face, modal] = card.split('<div class="card-modal"');
  assert.match(face, /<button class="card-open" type="button" popovertarget="card-doing-0">Long card<\/button>/);
  assert.match(face, /<p class="card-note">the short line<\/p>/);
  assert.doesNotMatch(face, /a much longer second line/);
  assert.match(modal, /^ id="card-doing-0" popover role="dialog" aria-labelledby="card-doing-0-h">/);
  assert.match(modal, /<h2 class="modal-title" id="card-doing-0-h">Long card<\/h2>/);
  assert.match(modal, /<li>the short line<\/li><li>a much longer second line<\/li>/);
  assert.match(modal, /<a target="_blank" rel="noopener" href="https:\/\/example.com\/x">/);
  assert.match(modal, /popovertarget="card-doing-0" popovertargetaction="hide" aria-label="Close"/);
});

test('a decision card shows how many options it has; the options are in its modal', () => {
  const asked = md.board.replace(/(- #3 .*\n)/, '$1  a) Yes (recommended)\n  b) No\n  c) Something else: tell Claude\n');
  const { html } = renderPage({ name: 'demo', md: { ...md, board: asked }, builtAt, template });
  const [face, modal] = html.match(/<li class="card-x card-decide">.*<\/li>/)[0].split('<div class="card-modal"');
  assert.match(face, /<p class="card-note">3 options<\/p>/);
  assert.doesNotMatch(face, /recommended/);
  assert.match(modal, /<li>a\) Yes \(recommended\)<\/li><li>b\) No<\/li><li>c\) Something else: tell Claude<\/li>/);
});

test('a card shows its story points, on its face and in its modal', () => {
  const board = withCards('- #7 Sized card · M1 · 3 pts\n  the short line\n- #8 Tiny card · M1 · 1 pt\n');
  const { html } = renderPage({ name: 'demo', md: board, builtAt, template });
  const [face, modal] = html.match(/<li class="card-x card-doing">.*Sized card.*<\/li>/)[0].split('<div class="card-modal"');
  assert.match(face, /<span class="card-id">#7<\/span><span class="tag pts pts-3">3 pts<\/span><\/div>/);
  assert.match(modal, /<span class="card-id">#7<\/span><span class="tag pts pts-3">3 pts<\/span><button class="modal-close"/);
  assert.match(html, /<span class="card-id">#8<\/span><span class="tag pts pts-1">1 pt<\/span>/);
  for (const n of [1, 2, 3, 5, 8, 13]) assert.match(html, new RegExp(`\\.pts-${n} \\{ --at: \\d+%; \\}`), `${n} has its colour`);
  assert.doesNotMatch(html, /<span class="card-id">#2<\/span><span class="tag/, 'a card without points shows none');
});

test('a card shows its stage as a six-part bar, filled up to that stage', () => {
  const board = withCards('- #7 Being tested · M1 · 3 pts · test\n  the short line\n- #8 Being built · M1\n');
  const { html } = renderPage({ name: 'demo', md: board, builtAt, template });
  const bar = (on, name) => `<p class="stage" title="Stage ${on} of 6"><span class="stage-bar" aria-hidden="true">${'<i class="on"></i>'.repeat(on)}${'<i></i>'.repeat(6 - on)}</span>${name}</p>`;
  const card = (title) => html.match(new RegExp(`<li class="card-x card-[a-z-]+">(?:(?!</li>).)*${title}.*</li>`))[0];
  const [face, modal] = card('Being tested').split('<div class="card-modal"');
  assert.ok(face.endsWith(bar(4, 'Test')), 'the bar is the last thing on the card');
  assert.ok(modal.includes(bar(4, 'Test')), 'and it is in the modal');
  assert.doesNotMatch(face, /Being tested · test|>test</, 'the stage word is not part of the title');
  assert.ok(card('Being built').includes(bar(3, 'Develop')), 'Doing with no stage written is Develop');
  assert.ok(card('Write <code>soloagile build</code>').includes(bar(1, 'Plan')), 'Up next is Plan');
  assert.ok(card('Check the page').includes(bar(6, 'Feedback')), 'a look is Feedback');
  assert.doesNotMatch(card('Push to GitHub'), /class="stage"/, 'a decision has no stage');
  assert.match(html, /\.stage-bar i\.on \{/);
});

test('a design waiting for a yes is a Design card in Waiting on you, with its bar at Design', () => {
  const design = '- #3 Stage strip · M1 · 5 pts · design · asked 2026-09-30\n  how a card shows its stage\n  a) A bar (recommended)\n  b) Something else: tell Claude\n';
  const board = md.board.replace(/- #3 .*\n/, design);
  const { html, problems } = renderPage({ name: 'demo', md: { ...md, board }, builtAt, template });
  assert.deepEqual(problems, []);
  const [face] = html.match(/<li class="card-x card-decide">.*Stage strip.*<\/li>/)[0].split('<div class="card-modal"');
  assert.match(face, /<span class="st st-hold"><svg[^>]*>.*?<\/svg>Design<\/span>/);
  assert.doesNotMatch(face, />Decide</);
  assert.match(face, /<span class="tag pts pts-5">5 pts<\/span>/);
  assert.match(face, /<p class="card-note">how a card shows its stage<\/p><p class="stage" title="Stage 2 of 6">.*Design<\/p>$/);
  assert.match(html, /<span class="key-name">Design<\/span>/);
});

test('on the desktop the lanes run in flow order; narrower screens keep Waiting on you first', () => {
  const { html } = renderPage({ name: 'demo', md, builtAt, template });
  const lanes = [...html.matchAll(/<section class="lane lane-([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(lanes, ['waiting', 'doing', 'up-next', 'ideas', 'done'], 'the order a phone shows');
  const wide = html.match(/@media \(min-width: 1101px\) \{\n([^@]*?)\n\}/)[1];
  const order = Object.fromEntries([...wide.matchAll(/\.lane-([a-z-]+) \{ order: (\d); \}/g)].map((m) => [m[1], Number(m[2])]));
  assert.deepEqual(order, { ideas: 1, 'up-next': 2, doing: 3, waiting: 4, done: 5 });
});

test("a look that can't happen yet is marked Later, sits last and isn't counted as waiting", () => {
  const looks = '- #2 Check the page · M1 · from 2026-10-01\n- #5 Check the phone · M1 · from 2026-09-30\n';
  const board = md.board.replace(/- #2 .*\n/, looks);
  const { html } = renderPage({ name: 'demo', md: { ...md, board }, builtAt, template });
  assert.match(html, /<li class="card-x card-later">.*<span class="st st-quiet"><svg[^]*?<\/svg>Later<\/span>.*Check the page.*From 1 Oct/);
  assert.match(html, /<li class="card-x card-look">.*Check the phone/, 'its day has come, so it is an ordinary look');
  assert.ok(html.indexOf('Check the phone') < html.indexOf('Check the page'), 'later looks come last');
  assert.match(html, /<span class="lane-name">Waiting on you<\/span><span class="lane-count">2<\/span>/);
  assert.match(html, /<span class="badge" aria-label="2 waiting on you">2<\/span>/);
});

test('a waiting card says how long it has waited; a later look and a queued card do not', () => {
  const board = md.board
    .replace(/- #2 .*\n/, '- #2 Check the page · M1 · live 2026-09-24\n- #5 Check the phone · M1 · from 2026-10-01\n- #6 Check the print · M1 · live 2026-09-30\n- #7 Check the fold · M1 · live 2026-09-29\n');
  const { html } = renderPage({ name: 'demo', md: { ...md, board }, builtAt, template });
  assert.match(html, /Live 24 Sep<span class="age" data-since="2026-09-24">waiting 6 days<\/span>/);
  assert.match(html, /Live 30 Sep<span class="age" data-since="2026-09-30">since today<\/span>/);
  assert.match(html, /Live 29 Sep<span class="age" data-since="2026-09-29">waiting 1 day<\/span>/);
  assert.equal(html.match(/class="age"/g).length, 4, 'the three looks that can be done and the decision: the later look and the queued card have none');
  assert.match(html, /querySelectorAll\('\[data-since\]'\)/, 'the open page counts the days again, so a page not rebuilt for a week is still right');
});

test('a card with no description has nothing to open', () => {
  const { html } = renderPage({ name: 'demo', md, builtAt, template });
  assert.doesNotMatch(html, /<button class="card-open"/);
  assert.doesNotMatch(html, /<div class="card-modal"/);
  assert.match(html, /<p class="card-title">Check the page<\/p>/);
});

test('Done shows the last 48 hours: today and the two days before', () => {
  const done = '## Done\n- #4 Today · M1 · 2026-09-30\n- #5 Two days back · M1 · 2026-09-28\n- #6 Three days back · M1 · 2026-09-27\n- #7 No date\n';
  const { html } = renderPage({ name: 'demo', md: { ...md, board: md.board.replace('## Done\n', done) }, builtAt, template });
  assert.match(html, /<span class="lane-name">Done<\/span><span class="lane-count">3<\/span><span class="lane-hint">last 48 hours<\/span>/);
  assert.match(html, /Today/);
  assert.match(html, /Two days back/);
  assert.doesNotMatch(html, /Three days back/);
  assert.match(html, /No date/);
});

test('plan shows progress and a status on each milestone', () => {
  const { html } = renderPage({ name: 'demo', md, builtAt, template });
  assert.match(html, /<b>1 of 2<\/b> milestones done/);
  assert.match(html, /<span class="seg seg-done"/);
  assert.match(html, /<h3 class="ms-h ms-h-done"><span class="tag tag-proj ms-c0"><svg[^>]*>.*?<\/svg>M0<\/span><span>Convention<\/span><span class="st st-go">Done 30 Sep<\/span><\/h3>/);
  assert.match(html, /<h3 class="ms-h ms-h-in-progress">.*<span class="st st-open">In progress<\/span>/);
});

test('plan milestones fold out: finished ones start folded, the rest open', () => {
  const plan = '# Plan\n## Milestones\n### M0 — Done one · done 2026-09-30\nOld text.\n\n### M1 — Open one · in progress\nNew text.\n';
  const { html } = renderPage({ name: 'demo', md: { ...md, plan }, builtAt, template });
  assert.match(html, /<details class="ms-fold" id="plan-M0"><summary><h3 class="ms-h ms-h-done">.*?<\/summary><div class="ms-body">\s*<p>Old text\.<\/p>\s*<\/div><\/details>/s);
  assert.match(html, /<details class="ms-fold" id="plan-M1" open><summary><h3 class="ms-h ms-h-in-progress">.*?<p>New text\.<\/p>/s);
});

// The plan's first open milestone is M1, but the cards being worked belong to later ones.
const inHand = (lanes) => {
  const cards = (lane) => (lanes[lane] ?? []).map((m, i) => `- #${lane.length}${i} A card · ${m}`).join('\n');
  return {
    ...md,
    board: `# Board\n<!-- next-id: 300 -->\n## Ideas\n## Up next\n${cards('Up next')}\n## Doing\n${cards('Doing')}\n## Needs your look\n${cards('Needs your look')}\n## Needs your decision\n## Done\n`,
    plan: '# Plan\n### M0 — Convention · done 2026-09-30\n### M1 — The page · in progress\n### M2 — Live · in progress\n### M3 — Home · not started\n',
  };
};
const working = (lanes) => renderPage({ name: 'demo', md: inHand(lanes), builtAt, template }).html.match(/Working on <b[^>]*>(M\d+)<\/b>/)?.[1];

test('the header names the milestone whose cards are moving, not the first one still open', () => {
  assert.equal(working({ Doing: ['M2'], 'Needs your look': ['M1', 'M1'] }), 'M2', 'Doing decides it');
  assert.equal(working({ 'Needs your look': ['M1', 'M2', 'M2'], 'Up next': ['M3'] }), 'M2', 'then the cards waiting on the user, by the most cards');
  assert.equal(working({ 'Needs your look': ['M1', 'M2'] }), 'M2', 'a tie goes to the later milestone');
  assert.equal(working({ 'Up next': ['M3'] }), 'M3', 'then Up next');
  assert.equal(working({ Doing: ['M0'], 'Up next': ['M2'] }), 'M2', 'a finished milestone is never in hand');
  assert.equal(working({}), 'M1', 'with no cards, the first open milestone');
  const { html } = renderPage({ name: 'demo', md: inHand({ Doing: ['M2'] }), builtAt, template });
  assert.match(html, /<li class="st st-open ms-current ms-c2" title="M2: Live, in progress">/);
});

test('release and decision headings get a date chip, and a commit chip when given', () => {
  const dated = { ...md, releases: "# Release notes\n## 2026-09-30 · M0 finished · a85e8c3\n**What's new**\n- a thing\n" };
  const { html } = renderPage({ name: 'demo', md: dated, builtAt, template });
  assert.match(html, /<h2 class="dated">.*<span class="dated-title">M0 finished<\/span>.*30 Sep<\/span><code class="sha">.*a85e8c3<\/code><\/h2>/);
  assert.match(html, /<h2 class="dated">.*<span class="dated-title">Links\?<\/span>/);
  assert.match(html, /<strong class="h-icon">.*What's new<\/strong>/);
});

test('each link gets an icon for where it points', () => {
  assert.equal(linkIcon('https://github.com/richardkoi/x'), 'git-branch');
  assert.equal(linkIcon('https://claude.ai/code/artifact/abc'), 'sparkles');
  assert.equal(linkIcon('http://192.168.0.10/myproject/'), 'server');
  assert.equal(linkIcon('http://mydesktop:8444'), 'server');
  assert.equal(linkIcon('file:///tmp/x.html'), 'file');
  assert.equal(linkIcon('https://example.com'), 'globe');
  const { html } = renderPage({ name: 'demo', md, builtAt, template });
  assert.match(html, /<li class="link-row"><svg[^]*?<\/svg><a target="_blank" rel="noopener" href="https:\/\/example.com">Site<\/a><span class="link-note">added 2026-09-30<\/span><\/li>/);
});

test('an empty lane shows a dash, and no badge when nothing waits', () => {
  const calm = { ...md, board: md.board.replace(/^- #[23] .*\n/gm, '') };
  const { html } = renderPage({ name: 'demo', md: calm, builtAt, template });
  assert.match(html, /<span class="lane-name">Waiting on you<\/span><span class="lane-count">0<\/span>.*\n<p class="lane-empty">&mdash;<\/p>/);
  assert.doesNotMatch(html, /class="badge"/);
});

test("plan.md's title names the page; plain '# Plan' falls back to the folder", () => {
  const titled = { ...md, plan: md.plan.replace('# Plan', '# Project Pages') };
  assert.match(renderPage({ name: 'demo', md: titled, builtAt, template }).html, /<h1 class="header-title">Project Pages<\/h1>/);
  assert.match(renderPage({ name: 'demo', md, builtAt, template }).html, /<h1 class="header-title">demo<\/h1>/);
});

test('the tab title ends in " - PM", and the page carries its own icon', () => {
  const titled = { ...md, plan: md.plan.replace('# Plan', '# Project Pages') };
  const { html } = renderPage({ name: 'demo', md: titled, builtAt, template });
  assert.match(html, /<title>Project Pages - PM<\/title>/);
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,%3Csvg [^"]*%3C\/svg%3E">/);
});

test('dates read short', () => {
  assert.equal(shortDate({ label: null, value: '2026-09-30' }), '30 Sep');
  assert.equal(shortDate({ label: 'built', value: '2026-01-05' }), 'Built 5 Jan');
});

test('only the template placeholders are filled, never the Markdown text', () => {
  const { html } = renderPage({ name: 'demo', md, builtAt, template });
  assert.match(html, /Literal \{\{board\}\} stays as written/);
  assert.equal((html.match(/\{\{/g) || []).length, 1);
});

test('web links open in a new tab; file links do not', () => {
  const { html } = renderPage({ name: 'demo', md, builtAt, template });
  assert.match(html, /<a target="_blank" rel="noopener" href="https:\/\/example.com">/);
  assert.match(html, /<a href="file:\/\/\/tmp\/x.html">/);
});

test('names HTML-escape, and the only scripts are the theme toggle and the one for days waiting, full-size pictures and live refresh', () => {
  const { html } = renderPage({ name: '<b>x</b>', md, builtAt, template });
  assert.match(html, /<h1 class="header-title">&lt;b&gt;x&lt;\/b&gt;<\/h1>/);
  assert.equal((html.match(/<script/gi) || []).length, 2);
  assert.match(html, /function toggleTheme\(\)/);
});

test('an open page asks the server for its ETag and reloads when it changes', () => {
  const { html } = renderPage({ name: 'demo', md, builtAt, template });
  assert.match(html, /fetch\(location\.pathname, \{ method: 'HEAD', cache: 'no-store' \}\)/);
  assert.match(html, /r\.headers\.get\('ETag'\)/);
  assert.match(html, /location\.reload\(\)/);
  assert.match(html, /if \(document\.querySelector\('\.card-modal:popover-open'\)\) return;/, 'an open card is never shut by a reload');
  assert.match(html, /if \(!\/\^https\?:\$\/\.test\(location\.protocol\)\) return;/, 'a file:// page never polls');
});

test('buildProject writes pm/index.html, even with pm/ files missing', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pm-test-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), md.board);
  const { out, problems } = buildProject(repo, builtAt);
  assert.equal(out, join(repo, 'pm', 'index.html'));
  assert.deepEqual(problems, []);
  assert.match(readFileSync(out, 'utf8'), /Check the page/);
});

test('a folder without pm/ is an error', () => {
  assert.throws(() => buildProject(mkdtempSync(join(tmpdir(), 'pm-test-'))), /no pm\/ folder/);
});

test("the starter pm/ files, which a new project begins with, follow the format", () => {
  const { name, md: own } = readProject(join(ROOT, 'starter'));
  const { problems } = renderPage({ name, md: own, builtAt, template });
  assert.deepEqual(problems, []);
});

test('icon shapes carry no <svg> tag of their own (a nested one hides the text after it)', async () => {
  const { ICONS } = await import('../src/icons.js');
  for (const [name, shapes] of Object.entries(ICONS)) assert.doesNotMatch(shapes, /<\/?svg/, name);
});

test('a "?" in the header opens the command guide: one list, in the order of a session', () => {
  const { html } = renderPage({ name: 'demo', md, builtAt, template });
  const header = html.match(/<header class="header">[^]*?<\/header>/)[0];
  assert.match(header, /<button class="btn btn-ghost help" type="button" popovertarget="guide" aria-label="What you can say">\?<\/button>/);
  assert.ok(header.indexOf('popovertarget="guide"') < header.indexOf('toggleTheme()'), 'it sits before the Dark/Light switch');
  const guide = html.match(/<div class="card-modal guide" id="guide" popover role="dialog" aria-labelledby="guide-h">[^]*?<\/ul>/)[0];
  assert.match(guide, /popovertarget="guide" popovertargetaction="hide" aria-label="Close"/);
  const rows = [...guide.matchAll(/<li>(.*)<\/li>/g)].map((m) => m[1]);
  assert.deepEqual(rows.map((r) => r.match(/<b class="guide-say">(.*?)<\/b>/)[1]),
    ['“catch me up”', '“what needs me”', '“#7 yes”', '“commit”', '“ship it”', '“retro”', '“done for today”', '/clear', 'Esc Esc']);
  for (const r of rows) assert.match(r, /<span class="guide-does">.+<\/span>/, 'every row says what it does');
  // Every typed command is a skill that exists.
  const typed = [...guide.matchAll(/<span class="guide-typed">\/soloagile:(\w+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(typed, ['catchup', 'needs', 'commit', 'retro', 'save']);
  for (const skill of typed) assert.ok(readFileSync(join(ROOT, 'skills', skill, 'SKILL.md'), 'utf8'), skill);
  assert.equal((html.match(/<script/gi) || []).length, 2, 'the guide needs no script');
});

test('each milestone has its own colour, one of eight taken in turn by its number', () => {
  assert.deepEqual(['M0', 'M1', 'M7', 'M8', 'M9', 'M17', 'Later'].map(msClass), ['ms-c0', 'ms-c1', 'ms-c7', 'ms-c0', 'ms-c1', 'ms-c1', '']);
  const { html } = renderPage({ name: 'demo', md, builtAt, template });
  assert.match(html, /<span class="tag tag-proj ms-c\d"><svg[^>]*>.*?<\/svg>M\d+<\/span><span class="card-id">/, "a card's milestone tag carries its colour");
  for (const n of [0, 1, 2, 3, 4, 5, 6, 7]) {
    assert.equal(html.match(new RegExp(`--ms-${n}: #`, 'g'))?.length, 2, `colour ${n} is set for dark and for light`);
    assert.match(html, new RegExp(`\\.ms-c${n} \\{ --m: var\\(--ms-${n}\\); \\}`));
  }
});

test('milestone chips carry the short name the plan gives them, on the top row and on cards', () => {
  const plan = '# Plan\n### M0 — Convention · done 2026-09-30\nshort: The rules\n### M1 — The page · in progress\nshort: First page\nDone when: it builds.\n### M2 — Live · not started\n';
  const { html } = renderPage({ name: 'demo', md: { ...md, plan }, builtAt, template });
  const strip = html.match(/<ol class="ms-strip"[^]*?<\/ol>/)[0];
  assert.match(strip, /M1<span class="ms-short">First page<\/span>/);
  assert.match(strip, /<span aria-hidden="true"><svg[^>]*>.*?<\/svg>M2<\/span><\/a><\/li>/, 'no short name: just the number');
  assert.doesNotMatch(strip, /The rules/, 'done milestones stay off the top row');
  assert.match(html, /<span class="tag tag-proj ms-c1"><svg[^>]*>.*?<\/svg>M1<span class="ms-short">First page<\/span><\/span>/, 'on a card');
  assert.doesNotMatch(html.match(/<section class="tab tab-plan"[^]*?<\/section>/)[0], /short:/, 'the short: line is not shown as text in the plan');
});

test('with every milestone done, the top row is just the done chip', () => {
  const plan = '# Plan\n### M0 — Convention · done 2026-09-30\n### M1 — The page · done 2026-10-01\n';
  const { html } = renderPage({ name: 'demo', md: { ...md, plan }, builtAt, template });
  assert.match(html, /<ol class="ms-strip" aria-label="Milestones"><li><a class="st st-go ms-done" href="#plan" title="2 milestones done: see the plan">.*?2 done<\/a><\/li><\/ol>/);
});

test('a milestone chip in the top row links to its milestone on the Plan tab', () => {
  const { html } = renderPage({ name: 'demo', md, builtAt, template });
  assert.match(html, /<li class="st st-open ms-current ms-c1" title="M1: The page, in progress"><a class="ms-link" href="#plan-M1">/);
  assert.match(html, /<details class="ms-fold" id="plan-M1" open>/);
  assert.match(html, /<details class="ms-fold" id="plan-M0">/);
});

test("a project's Markdown can't put HTML or a javascript: link on its page; soloagile's own can", async () => {
  const { block, inline, trustedBlock } = await import('../src/page.js');
  const html = block('a <script>alert(1)</script> <img src=http://127.0.0.1:8473/home>\n\n[bad](javascript:alert(1)) [web](https://example.com) [tab](#plan)');
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /<a target="_blank" rel="noopener" href="https:\/\/example.com">web<\/a>/);
  assert.match(html, /<a href="#plan">tab<\/a>/);
  assert.equal(inline('#3 <b>bold</b>'), '#3 &lt;b&gt;bold&lt;/b&gt;');
  assert.match(trustedBlock('<ol class="wheel"><li>Plan</li></ol>'), /<ol class="wheel">/);
});
