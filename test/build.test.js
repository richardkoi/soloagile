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
  assert.doesNotMatch(html, /class="ms-strip"/, 'no row of milestone chips in the header (#217)');
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
  assert.match(html, /<li class="card-x card-decide"[^>]*>.*Push to GitHub\?/);
  assert.match(html, /<li class="card-x card-look"[^>]*>.*Check the page/);
  assert.match(html, /<li class="card-x card-up-next"[^>]*>.*soloagile build/);
});

const withCards = (lines) => ({ ...md, board: md.board.replace('## Doing\n', `## Doing\n${lines}`) });

test('a card shows one short line, and its full description in a modal', () => {
  const board = withCards('- #7 Long card · M1\n  the short line\n  a much longer second line\n  see https://example.com/x\n');
  const { html } = renderPage({ name: 'demo', md: board, builtAt, template });
  const card = html.match(/<li class="card-x card-doing"[^>]*>.*Long card.*<\/li>/)[0];
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
  const [face, modal] = html.match(/<li class="card-x card-decide"[^>]*>.*<\/li>/)[0].split('<div class="card-modal"');
  assert.match(face, /<p class="card-note">3 options<\/p>/);
  assert.doesNotMatch(face, /recommended/);
  assert.match(modal, /<li>a\) Yes \(recommended\)<\/li><li>b\) No<\/li><li>c\) Something else: tell Claude<\/li>/);
});

test('a card shows its number in its head and its story points in its foot, on its face and in its modal', () => {
  const board = withCards('- #7 Sized card · M1 · 3 pts\n  the short line\n- #8 Tiny card · M1 · 1 pt\n');
  const { html } = renderPage({ name: 'demo', md: board, builtAt, template });
  const [face, modal] = html.match(/<li class="card-x card-doing"[^>]*>.*Sized card.*<\/li>/)[0].split('<div class="card-modal"');
  assert.match(face, /<div class="card-top">.*<span class="card-id">#7<\/span><\/div>/);
  assert.match(face, /<div class="card-foot"><p class="stage"[^]*?<\/p><span class="tag pts pts-3">3 pts<\/span><\/div>$/);
  assert.match(modal, /<span class="card-id">#7<\/span><button class="modal-close"/);
  assert.match(modal, /<div class="card-foot"><p class="stage"[^]*?<\/p><span class="tag pts pts-3">3 pts<\/span><\/div><ul class="modal-body">/);
  assert.match(html, /<span class="tag pts pts-1">1 pt<\/span><\/div><\/li>/);
  for (const n of [1, 2, 3, 5, 8, 13]) assert.match(html, new RegExp(`\\.pts-${n} \\{ --at: \\d+%; \\}`), `${n} has its colour`);
  assert.doesNotMatch(html.match(/<li class="card-x[^"]*"[^>]*>(?:(?!<\/li>).)*#2<\/span>.*?<\/li>/)[0], /class="tag pts/, 'a card without points shows none');
});

test('a card shows its stage as a six-part bar, filled up to that stage', () => {
  const board = withCards('- #7 Being tested · M1 · 3 pts · test\n  the short line\n- #8 Being built · M1\n');
  const { html } = renderPage({ name: 'demo', md: board, builtAt, template });
  const bar = (on, name) => `<p class="stage" title="Stage ${on} of 6"><span class="stage-bar" aria-hidden="true">${'<i class="on"></i>'.repeat(on)}${'<i></i>'.repeat(6 - on)}</span>${name}</p>`;
  const card = (title) => html.match(new RegExp(`<li class="card-x card-[a-z-]+"[^>]*>(?:(?!</li>).)*${title}.*</li>`))[0];
  const [face, modal] = card('Being tested').split('<div class="card-modal"');
  assert.ok(face.endsWith(`<div class="card-foot">${bar(4, 'Test')}<span class="tag pts pts-3">3 pts</span></div>`), 'the bar opens the card\'s foot');
  assert.ok(modal.includes(bar(4, 'Test')), 'and it is in the modal');
  assert.doesNotMatch(face, /Being tested · test|>test</, 'the stage word is not part of the title');
  assert.ok(card('Being built').includes(bar(3, 'Develop')), 'Doing with no stage written is Develop');
  assert.doesNotMatch(card('Write <code>soloagile build</code>'), /class="stage"/, 'an Up next card has no bar: every one would say Plan (#222)');
  assert.ok(card('Check the page').includes(bar(6, 'Feedback')), 'a look is Feedback');
  assert.doesNotMatch(card('Push to GitHub'), /class="stage"/, 'a decision has no stage');
  assert.match(html, /\.stage-bar i\.on \{/);
});

test('a design waiting for a yes is a Design card in Waiting on you, with its bar at Design', () => {
  const design = '- #3 Stage strip · M1 · 5 pts · design · asked 2026-09-30\n  how a card shows its stage\n  a) A bar (recommended)\n  b) Something else: tell Claude\n';
  const board = md.board.replace(/- #3 .*\n/, design);
  const { html, problems } = renderPage({ name: 'demo', md: { ...md, board }, builtAt, template });
  assert.deepEqual(problems, []);
  const [face] = html.match(/<li class="card-x card-decide"[^>]*>.*Stage strip.*<\/li>/)[0].split('<div class="card-modal"');
  assert.match(face, /<span class="st st-hold"><svg[^>]*>.*?<\/svg>Design<\/span>/);
  assert.doesNotMatch(face, />Decide</);
  assert.match(face, /<span class="tag pts pts-5">5 pts<\/span>/);
  assert.match(face, /<p class="card-note">how a card shows its stage<\/p><p class="card-meta">.*<\/p><div class="card-foot"><p class="stage" title="Stage 2 of 6">.*Design<\/p><span class="tag pts pts-5">5 pts<\/span><\/div>$/);
  assert.match(html, /<span class="key-name">Design<\/span>/);
});

test('on the desktop Waiting on you comes first and Ideas last; a phone keeps its own order (#228)', () => {
  const { html } = renderPage({ name: 'demo', md, builtAt, template });
  const lanes = [...html.matchAll(/<section class="lane lane-([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(lanes, ['waiting', 'doing', 'up-next', 'ideas', 'done'], 'the order a phone shows');
  const wide = html.match(/@media \(min-width: 1101px\) \{\n([^@]*?)\n\}/)[1];
  const order = Object.fromEntries([...wide.matchAll(/\.lane-([a-z-]+) \{ order: (\d); \}/g)].map((m) => [m[1], Number(m[2])]));
  assert.deepEqual(order, { waiting: 1, doing: 2, 'up-next': 3, done: 4, ideas: 5 });
});

test('on a phone the search box and the milestone menu each take the full width (#217)', () => {
  const { html } = renderPage({ name: 'demo', md, builtAt, template });
  assert.match(html, /\.board-tools \{ display: flex; flex-wrap: wrap;/);
  const phone = html.match(/@media \(max-width: 700px\) \{\n([\s\S]*?)\n\}/)[1];
  assert.match(phone, /\.board-tools > \.card-find, \.board-tools > \.ms-filter \{ flex: 1 1 100%; \}/);
  assert.doesNotMatch(html, /\.ms-strip|\.ms-chip/, 'the old chip styles are gone');
});

test("a look that can't happen yet is marked Later, sits last and isn't counted as waiting", () => {
  const looks = '- #2 Check the page · M1 · from 2026-10-01\n- #5 Check the phone · M1 · from 2026-09-30\n';
  const board = md.board.replace(/- #2 .*\n/, looks);
  const { html } = renderPage({ name: 'demo', md: { ...md, board }, builtAt, template });
  assert.match(html, /<li class="card-x card-later"[^>]*>.*<span class="st st-quiet"><svg[^]*?<\/svg>Later<\/span>.*Check the page.*From 1 Oct/);
  assert.match(html, /<li class="card-x card-look"[^>]*>.*Check the phone/, 'its day has come, so it is an ordinary look');
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
  assert.match(html, /<span class="lane-name">Done<\/span><span class="lane-count">3<\/span>.*<div class="lane-sub"><div class="lane-hints"><span class="lane-hint">last 48 hours<\/span><\/div>/);
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
  assert.match(html, /Working on <b class="ms-ink ms-c2">M2<\/b> Live/);
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

test('an empty lane says so in words, and no badge when nothing waits (#226)', () => {
  const calm = { ...md, board: md.board.replace(/^- #[23] .*\n/gm, '') };
  const { html } = renderPage({ name: 'demo', md: calm, builtAt, template });
  assert.match(html, /<span class="lane-name">Waiting on you<\/span><span class="lane-count">0<\/span>.*\n<p class="lane-empty">Nothing waiting on you<\/p>/);
  assert.match(html, /<p class="lane-empty">Claude isn&#39;t building anything<\/p>/);
  assert.doesNotMatch(html, /lane-empty">&mdash;/, 'no dash: it meant nothing on its own');
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

test('buildProject warns when the page passes about 5 MB, naming its size (#128)', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pm-test-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), md.board);
  writeFileSync(join(repo, 'pm', 'decisions.md'), `# Decisions\n\n${'A long note about a choice. '.repeat(200000)}\n`);
  const { problems } = buildProject(repo, builtAt);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^index\.html is 5\.\d MB: a page over 5 MB is slow to open; look for what is filling it, such as a long decisions\.md$/);
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

test('milestones carry the short name the plan gives them, in the menu and on cards', () => {
  const plan = '# Plan\n### M0 — Convention · done 2026-09-30\nshort: The rules\n### M1 — The page · in progress\nshort: First page\nDone when: it builds.\n### M2 — Live · not started\n';
  const board = md.board.replace('## Ideas\n', '## Ideas\n- #8 Later · M2\n');
  const { html } = renderPage({ name: 'demo', md: { ...md, plan, board }, builtAt, template });
  const menu = html.match(/<label class="ms-filter"[^]*?<\/label>/)[0];
  assert.match(menu, /<option value="M1">M1 First page<\/option>/);
  assert.match(menu, /<option value="M2">M2<\/option>/, 'no short name: just the number');
  assert.doesNotMatch(menu, /The rules/, 'done milestones stay out of the menu');
  assert.match(html, /<span class="tag tag-proj ms-c1" title="M1 First page"><svg[^>]*>.*?<\/svg>M1<span class="ms-short">First page<\/span><\/span>/, 'on a card');
  assert.doesNotMatch(html.match(/<section class="tab tab-plan"[^]*?<\/section>/)[0], /short:/, 'the short: line is not shown as text in the plan');
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

test("a card's guessed build time shares the size chip with its points", () => {
  const board = withCards('- #7 Guessed · M1 · 3 pts · ~40 min\n- #8 Long guess · M1 · 8 pts · ~2.5 h\n');
  const { html } = renderPage({ name: 'demo', md: board, builtAt, template });
  assert.match(html, /<span class="tag pts pts-3">3 pts<span class="guess" title="Guessed build time">~40 min<\/span><\/span>/);
  assert.match(html, /<span class="tag pts pts-8">8 pts<span class="guess" title="Guessed build time">~2\.5 h<\/span><\/span>/);
  assert.match(html, /\.card-foot \{/);
});

test('a built card with a guess says under its foot how long it took', () => {
  const board = { ...md, board: md.board.replace('## Done\n', '## Done\n- #20 Shipped · M1 · 2 pts · ~40 min · 2026-09-30\n- #21 Not logged · M1 · 2 pts · ~40 min · 2026-09-30\n') };
  const history = '- 2026-09-30 09:00 · Doing · #20 Shipped · M1 · 2 pts · ~40 min · develop\n- 2026-09-30 09:52 · Needs your look · #20 Shipped · M1 · 2 pts · ~40 min\n';
  const { html } = renderPage({ name: 'demo', md: { ...board, history }, builtAt, template });
  const card = (t) => html.match(new RegExp(`<li class="card-x card-done"[^>]*>(?:(?!<\\/li>).)*${t}.*?<\\/li>`))[0];
  assert.match(card('Shipped'), /<\/div><p class="card-took">guessed 40 min, took 52 min<\/p><\/li>$/);
  assert.doesNotMatch(card('Not logged'), /card-took/, 'no build time in the log, no line');
  assert.match(card('Shipped'), /<span class="tag pts pts-2">2 pts<\/span>/, 'the chip drops the guess the line already says (#223)');
  assert.match(card('Not logged'), /2 pts<span class="guess"/, 'with no line, the chip keeps it');
});

test('a card with no stage, such as a Done card, puts its date in the foot beside the size chip', () => {
  const board = { ...md, board: md.board.replace('## Done\n', '## Done\n- #20 Shipped · M1 · 2 pts · 2026-09-30\n') };
  const { html } = renderPage({ name: 'demo', md: board, builtAt, template });
  const card = html.match(/<li class="card-x card-done"[^>]*>(?:(?!<\/li>).)*Shipped.*?<\/li>/)[0];
  assert.match(card, /<div class="card-foot"><p class="card-meta">.*30 Sep<\/p><span class="tag pts pts-2">2 pts<\/span><\/div><\/li>$/);
  assert.equal(card.match(/class="card-meta"/g).length, 1, 'the date is shown once');
});

test('with cards in two milestones or more, a row of milestone chips above the lanes filters the board', () => {
  const plan = `# Plan
### M1 — The page · in progress
short: First page
### M2 — More · not started
### M3 — Unused · not started
`;
  const board = `# Board
## Ideas
- #4 Later idea · M2
## Up next
- #1 Write it · M1
- #5 No milestone
## Doing
## Needs your look
- #2 Check it · M1 · built 2026-09-30
## Needs your decision
## Done
`;
  const { html } = renderPage({ name: 'demo', md: { ...md, plan, board }, builtAt, template });
  const bar = html.match(/<div class="board-tools"><div class="card-find">[^]*?<\/div><label class="ms-filter"[^]*?<\/label><\/div>/)?.[0];
  assert.ok(bar, 'the milestone menu sits beside the search box (#217)');
  assert.match(bar, /<span class="ms-filter-label">Milestone<\/span><select aria-label="Show one milestone's cards"><option value="">All<\/option>/);
  // In plan order, only milestones that have cards, each with its short name.
  const options = [...bar.matchAll(/<option value="(M\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(options, ['M1', 'M2']);
  assert.match(bar, /<option value="M1">M1 First page<\/option>/);
  assert.doesNotMatch(bar, /<button/, 'no chip buttons');
  // Each card carries its milestone, so the page's script can hide the others.
  assert.match(html, /<li class="card-x card-up-next" data-ms="M1" data-id="\d+">/);
  assert.match(html, /<li class="card-x card-up-next" data-ms="" data-id="\d+">/);
  assert.match(html, /<li class="card-x card-ideas" data-ms="M2" data-id="\d+">/);
});

test('with one milestone on the board, there is no milestone menu', () => {
  const { html } = renderPage({ name: 'demo', md, builtAt, template });
  assert.doesNotMatch(html, /class="ms-filter"/);
});

test('a search box finds a card by its words or number (#132)', () => {
  const { html } = renderPage({ name: 'demo', md, builtAt, template });
  // The box sits above the lanes, even with no chip row; the page's script does the finding.
  assert.match(html, /<div class="card-find"><input type="search"[^>]*aria-label="Find a card"[^>]*><span class="card-find-note" aria-live="polite"><\/span><\/div>/);
  assert.match(html, /data-id="\d+"/);
  assert.match(html, /\.card-x\.find-dim \{/);
  assert.match(html, /card-find[^]*showPopover/, 'Enter on a number opens that card');
});

test("each lane's heading shows its total points, and a lane with none shows no total (#133)", () => {
  const board = '# Board\n<!-- next-id: 9 -->\n## Ideas\n- #1 A · M1 · 2 pts\n- #2 B · M1 · 3 pts\n## Up next\n- #3 C · M1\n## Doing\n- #4 D · M1 · 1 pt · develop\n## Needs your look\n## Needs your decision\n## Done\n';
  const { html } = renderPage({ name: 'demo', md: { ...md, board }, builtAt, template });
  assert.match(html, /<span class="lane-name">Ideas<\/span><span class="lane-count">2<\/span>.*?<div class="lane-sub">.*?<span class="lane-points">5 pts<\/span><\/div>/);
  assert.match(html, /<span class="lane-name">Doing<\/span><span class="lane-count">1<\/span>.*?<span class="lane-points">1 pt<\/span><\/div>/);
  assert.match(html, /<span class="lane-name">Up next<\/span><span class="lane-count">1<\/span><\/div><div class="lane-sub"><div class="lane-hints">[^]*?<\/div><\/div>\n/);
});

test('Ideas and Done have a fold button, and the page remembers which are folded (#134)', () => {
  const { html } = renderPage({ name: 'demo', md, builtAt, template });
  for (const [key, name] of [['ideas', 'Ideas'], ['done', 'Done']]) {
    assert.match(html, new RegExp(`<section class="lane lane-${key}"[^>]*>\\n<div class="lane-head">.*<button type="button" class="lane-fold" aria-expanded="true" aria-label="Fold ${name} to a strip"`));
  }
  for (const key of ['waiting', 'doing', 'up-next']) {
    assert.doesNotMatch(html.split(`lane-${key}"`)[1].split('</section>')[0], /lane-fold/);
  }
  assert.match(html, /'soloagile-fold:' \+ location\.pathname/);
});

test('buildProject warns about a file:// address in links.md (#168)', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pm-test-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), md.board);
  writeFileSync(join(repo, 'pm', 'links.md'), '# Links\n\n## Local\n- [The report](file:///home/me/report.html) · added 2026-10-29\n- [Dev server](http://localhost:5173) · added 2026-10-29\n');
  const { problems } = buildProject(repo, builtAt);
  assert.deepEqual(problems, ['links.md: file:///home/me/report.html is a file:// address, which opens only on this machine; serve it and link the http address instead']);
});

test('a milestone whose cards are all Done leaves the menu; its cards still show under Done (#183)', () => {
  const day = (d) => d.toISOString().slice(0, 10);
  const board = `# Board
<!-- next-id: 9 -->
## Ideas
## Up next
- #1 Write it · M1 · 2 pts
  done when: written
- #3 Plan it · M3 · 1 pt
  done when: planned
## Doing
## Needs your look
## Needs your decision
## Done
- #2 Finished · M2 · 1 pt · ${day(builtAt)}
`;
  const { html } = renderPage({ name: 'demo', md: { ...md, board }, builtAt, template });
  const bar = html.match(/<label class="ms-filter"[^]*?<\/label>/)?.[0];
  assert.deepEqual([...bar.matchAll(/<option value="(M\d+)"/g)].map((m) => m[1]), ['M1', 'M3']);
  assert.match(html, /<li class="card-x card-done" data-ms="M2" data-id="\d+">/, 'the finished card is still on the board');
});

test("a card's pop-up starts each detail line with its label in bold, and lists an options line one to a line (#225)", () => {
  const board = withCards([
    '- #7 Labelled · M1 · 3 pts',
    '  found by #1489, notes 14 and 48: a round spent turning round',
    '  done when: each game has its first target ahead',
    '  options: a) targets ahead (Claude\'s pick) b) the plane turned c) both: targets ahead, and the plane levelled',
    '  tested: `node --test` passes',
    '  see https://example.com/x for the play-test',
    '  a plain line with no label',
    '',
  ].join('\n'));
  const { html } = renderPage({ name: 'demo', md: board, builtAt, template });
  const modal = html.match(/<ul class="modal-body">.*?<\/ul><\/div>/)[0];
  assert.match(modal, /<li><b class="detail-label">found by #1489, notes 14 and 48:<\/b> a round spent turning round<\/li>/);
  assert.match(modal, /<li><b class="detail-label">done when:<\/b> each game has its first target ahead<\/li>/);
  assert.match(modal, /<li><b class="detail-label">tested:<\/b> <code>node --test<\/code> passes<\/li>/);
  assert.match(modal, /<b class="detail-label">options:<\/b><ul class="detail-options"><li>a\) targets ahead \(Claude&#39;s pick\)<\/li><li>b\) the plane turned<\/li><li>c\) both: targets ahead, and the plane levelled<\/li><\/ul>/);
  assert.match(modal, /<li>see <a target="_blank" rel="noopener" href="https:\/\/example.com\/x">/, 'a link is not a label');
  assert.match(modal, /<li>a plain line with no label<\/li>/);
  assert.match(html, /\.detail-label \{/);
});
