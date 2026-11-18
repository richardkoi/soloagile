import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import './isolate.js';
import { buildProject } from '../src/build.js';
import { buildHome } from '../src/home.js';
import { stampOf } from '../src/settings.js';
import { findBrowser, withPage } from '../src/shots.js';

const board = (title) => `# Board\n<!-- next-id: 2 -->\n## Ideas\n## Up next\n- #1 ${title} · M1 · 2 pts\n## Doing\n## Needs your look\n## Needs your decision\n## Done\n`;

function project(title) {
  const repo = mkdtempSync(join(tmpdir(), 'pm-refresh-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), board(title));
  return repo;
}

test('each build leaves a stamp outside the project, and the page knows where and when', () => {
  const repo = project('First title');
  const builtAt = new Date('2026-10-02T12:00:00.000Z');
  const { out } = buildProject(repo, builtAt);
  const { file, url } = stampOf(out);
  assert.ok(file.startsWith(join(process.env.SOLOAGILE_DIR, 'stamps')), 'in ~/.soloagile/stamps, so git sees nothing new in the project');
  assert.equal(readFileSync(file, 'utf8'), 'window.__soloagileBuilt && window.__soloagileBuilt("2026-10-02T12:00:00.000Z");\n');
  const html = readFileSync(out, 'utf8');
  assert.ok(html.includes(`var stamp = "${url}", mine = "2026-10-02T12:00:00.000Z";`));
  assert.ok(!existsSync(join(repo, 'pm', 'stamp.js')));
});

test('a page opened as a file refreshes itself after a rebuild', { skip: !findBrowser() && 'no browser here' }, async () => {
  const repo = project('First title');
  const { out } = buildProject(repo, new Date('2026-10-02T12:00:00.000Z'));
  const seen = await withPage(pathToFileURL(out).href, async (page) => {
    const text = async () => (await page.send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true })).result.value;
    assert.match(await text(), /First title/);
    writeFileSync(join(repo, 'pm', 'board.md'), board('Second title'));
    buildProject(repo, new Date('2026-10-02T12:05:00.000Z'));
    // The open page looks for a new stamp every 3 seconds.
    for (let i = 0; i < 40 && !/Second title/.test(await text().catch(() => '')); i++) await new Promise((ok) => setTimeout(ok, 250));
    return text();
  });
  assert.match(seen, /Second title/, 'the open page reloaded by itself, with no server');
});

// A tiny stand-in for the page server: the file, with an ETag that changes with each build.
function serve(file) {
  return new Promise((ok) => {
    const server = createServer((req, res) => {
      const s = statSync(file);
      res.writeHead(200, { 'Content-Type': 'text/html', ETag: `"${s.mtimeMs}-${s.size}"`, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => ok(server));
  });
}

test('a page served over http refreshes after a card read during the rebuild is closed', { skip: !findBrowser() && 'no browser here' }, async () => {
  const repo = project('First title');
  const { out } = buildProject(repo, new Date('2026-10-02T12:00:00.000Z'));
  const server = await serve(out);
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  try {
    const seen = await withPage(`http://127.0.0.1:${server.address().port}/`, async (page) => {
      const run = async (expression) => (await page.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
      const text = () => run('document.body.innerText');
      assert.match(await text(), /First title/);
      await run("document.querySelector('.card-modal').showPopover()");
      writeFileSync(join(repo, 'pm', 'board.md'), board('Second title'));
      buildProject(repo, new Date('2026-10-02T12:05:00.000Z'));
      // While the card is open the page must not reload: give it two checks.
      await wait(7000);
      assert.equal(await run("!!document.querySelector('.card-modal:popover-open')"), true, 'the open card was left alone');
      await run("document.querySelector('.card-modal').hidePopover()");
      for (let i = 0; i < 40 && !/Second title/.test(await text().catch(() => '')); i++) await wait(250);
      return text();
    });
    assert.match(seen, /Second title/, 'the page reloaded once the card was closed');
  } finally {
    server.close();
  }
});

test("a card's milestone chip keeps the short name's whole words that fit, else the number alone (#221)", { skip: !findBrowser() && 'no browser here' }, async () => {
  const repo = mkdtempSync(join(tmpdir(), 'pm-chip-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), '# Board\n<!-- next-id: 4 -->\n## Ideas\n## Up next\n- #1 Long · M1 · 2 pts\n- #2 Short · M2 · 2 pts\n- #3 Huge · M3 · 2 pts\n## Doing\n## Needs your look\n## Needs your decision\n## Done\n');
  writeFileSync(join(repo, 'pm', 'plan.md'), '# Plan\n### M1 — One · not started\nshort: Starts, respawns and the drones seen\n### M2 — Two · not started\nshort: Tiny\n### M3 — Three · not started\nshort: Supercalifragilisticexpialidocious\n');
  const { out } = buildProject(repo, new Date('2026-10-02T12:00:00.000Z'));
  const chips = await withPage(pathToFileURL(out).href, async (page) => {
    // Five lanes in a row at 1400px, as on weatherglider's shots: each lane about 250px wide.
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise((ok) => setTimeout(ok, 300));
    const expression = `[...document.querySelectorAll('.lane-body > .card-x > .card-top .tag-proj')].map((c) => {
      const s = c.querySelector('.ms-short');
      return { whole: c.scrollWidth <= c.clientWidth, shown: s.hidden ? '' : s.textContent, fits: s.hidden || s.getBoundingClientRect().right <= c.getBoundingClientRect().right - parseFloat(getComputedStyle(c).paddingRight) - parseFloat(getComputedStyle(c).borderRightWidth) + 0.01, title: c.title };
    })`;
    return (await page.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  });
  const [long, short, huge] = chips;
  assert.ok(long.fits && short.fits && huge.fits, 'no chip is cut off');
  assert.ok(long.shown && long.shown.length < 30, `cut short: "${long.shown}"`);
  assert.match('Starts, respawns and the drones seen', new RegExp(`^${long.shown}[, ]`), 'it stops at a whole word');
  assert.doesNotMatch(long.shown, /,$/, 'and not on a comma');
  assert.doesNotMatch(long.shown, / (and|the)$/, 'nor on a joining word');
  assert.equal(short.shown, 'Tiny', 'a name that fits stays whole');
  assert.equal(huge.shown, '', 'one word too long: the number alone');
  assert.ok(huge.whole, 'and the number itself is never cut');
  assert.equal(long.title, 'M1 Starts, respawns and the drones seen', 'the whole name on hover');
});

test('at 1400px every lane heading is one height, so the first cards line up (#224)', { skip: !findBrowser() && 'no browser here' }, async () => {
  const repo = mkdtempSync(join(tmpdir(), 'pm-heads-'));
  mkdirSync(join(repo, 'pm'));
  const cards = (from, n, col) => Array.from({ length: n }, (_, i) => `- #${from + i} ${col} card ${i} · M1 · 2 pts · ~40 min · 2026-10-01`).join('\n');
  writeFileSync(join(repo, 'pm', 'board.md'), `# Board\n<!-- next-id: 60 -->\n## Ideas\n${cards(1, 3, 'Idea')}\n## Up next\n${cards(10, 30, 'Next')}\n## Doing\n${cards(45, 1, 'Doing')}\n## Needs your look\n- #50 Look card · M1 · 2 pts · live 2026-10-01\n## Needs your decision\n## Done\n${cards(51, 2, 'Done')}\n`);
  // Four past days of three cards, so Up next has a batch guess: 30 cards run to days ("by Fri").
  const history = [1, 2, 3, 4].flatMap((d) => [0, 1, 2].flatMap((i) => [
    `- 2026-09-0${d} ${String(8 + i).padStart(2, '0')}:00 · Doing · #${100 + d * 10 + i} Old · M1 · 2 pts · develop`,
    `- 2026-09-0${d} ${String(8 + i).padStart(2, '0')}:50 · Needs your look · #${100 + d * 10 + i} Old · M1 · 2 pts`,
  ])).join('\n');
  writeFileSync(join(repo, 'pm', 'history.md'), `# History\n${history}\n`);
  const { out } = buildProject(repo, new Date(2026, 9, 1, 12, 0));
  const seen = await withPage(pathToFileURL(out).href, async (page) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise((ok) => setTimeout(ok, 300));
    const expression = `({ heads: [...document.querySelectorAll('.lane-head')].map((h) => Math.round(h.getBoundingClientRect().height)), parts: [...document.querySelectorAll('.lane-head')].map((h) => h.className + ':' + [...h.children].map((c) => c.className + '=' + Math.round(c.getBoundingClientRect().height)).join('/')),
      batch: document.querySelector('.lane-batch')?.innerText ?? '' })`;
    return (await page.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  });
  assert.match(seen.batch, /likely/, 'Up next has its batch guess');
  assert.match(seen.batch, /^likely \d+(\.5)? h\nsurely \d+(\.5)? h$/, `a batch ending on another day has no clock time (#229): ${seen.batch}`);
  assert.equal(new Set(seen.heads).size, 1, `every heading one height: ${seen.heads.join(", ")} ${seen.parts.join(" ")}`);
});

test('on desktop the lanes run Waiting on you, Doing, Up next, Done, Ideas; a phone keeps its order (#228)', { skip: !findBrowser() && 'no browser here' }, async () => {
  const repo = project('A card');
  const { out } = buildProject(repo, new Date('2026-10-02T12:00:00.000Z'));
  const order = (width) => withPage(pathToFileURL(out).href, async (page) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await new Promise((ok) => setTimeout(ok, 300));
    // Lanes in the order they show: left to right, then top to bottom.
    const expression = `[...document.querySelectorAll('.lane')].map((l) => ({ n: l.querySelector('.lane-name').textContent, r: l.getBoundingClientRect() }))
      .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left).map((l) => l.n).join(', ')`;
    return (await page.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  });
  assert.equal(await order(1400), 'Waiting on you, Doing, Up next, Done, Ideas');
  assert.equal(await order(360), 'Waiting on you, Doing, Up next, Ideas, Done');
});

test('on desktop a long lane shows its first 10 cards and a Show all button; search, a milestone and #n still find the rest (#219)', { skip: !findBrowser() && 'no browser here' }, async () => {
  const repo = mkdtempSync(join(tmpdir(), 'pm-more-'));
  mkdirSync(join(repo, 'pm'));
  // 15 Up next cards: #1-#12 in M1, #13-#15 in M2; #14 holds the word "zebra".
  const next = Array.from({ length: 15 }, (_, i) => `- #${i + 1} ${i === 13 ? 'Zebra' : 'Next'} card ${i + 1} · ${i < 12 ? 'M1' : 'M2'} · 2 pts\n  a line`).join('\n');
  writeFileSync(join(repo, 'pm', 'board.md'), `# Board\n<!-- next-id: 20 -->\n## Ideas\n- #16 One idea · M1\n## Up next\n${next}\n## Doing\n## Needs your look\n## Needs your decision\n## Done\n`);
  writeFileSync(join(repo, 'pm', 'plan.md'), '# Plan\n### M1 — One · not started\n### M2 — Two · not started\n');
  const { out } = buildProject(repo, new Date('2026-10-02T12:00:00.000Z'));
  const seen = await withPage(pathToFileURL(out).href, async (page) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise((ok) => setTimeout(ok, 300));
    const run = async (expression) => (await page.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    const state = () => run(`({ shown: [...document.querySelectorAll('.lane-up-next .card-x')].filter((li) => li.offsetParent).length,
      button: document.querySelector('.lane-up-next .lane-more')?.offsetParent ? document.querySelector('.lane-up-next .lane-more').textContent : '',
      ideasButton: !!document.querySelector('.lane-ideas .lane-more')?.offsetParent })`);
    const steps = {};
    steps.start = await state();
    await run(`document.querySelector('.lane-up-next .lane-more').click()`);
    steps.all = await state();
    await run(`document.querySelector('.lane-up-next .lane-more').click()`);
    steps.fewer = await state();
    await run(`(() => { const m = document.querySelector('.ms-filter select'); m.value = 'M2'; m.dispatchEvent(new Event('change')); })()`);
    steps.m2 = await state();
    await run(`(() => { const m = document.querySelector('.ms-filter select'); m.value = ''; m.dispatchEvent(new Event('change')); })()`);
    await run(`(() => { const b = document.querySelector('.card-find input'); b.value = 'zebra'; b.dispatchEvent(new Event('input')); })()`);
    steps.zebra = await run(`!!document.querySelector('[data-id="14"]').offsetParent`);
    await run(`(() => { const b = document.querySelector('.card-find input'); b.value = '#15'; b.dispatchEvent(new Event('input')); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
    steps.open = await run(`!!document.querySelector('[data-id="15"] .card-modal:popover-open') && !!document.querySelector('[data-id="15"]').offsetParent`);
    return steps;
  });
  assert.deepEqual(seen.start, { shown: 10, button: 'Show all 15', ideasButton: false }, 'ten cards, then the button; a short lane has none');
  assert.deepEqual(seen.all, { shown: 15, button: 'Show the first 10', ideasButton: false });
  assert.deepEqual(seen.fewer, seen.start);
  assert.equal(seen.m2.shown, 3, "a milestone pick shows its cards, though they were past the first 10");
  assert.equal(seen.m2.button, '');
  assert.equal(seen.zebra, true, 'a search shows a match past the first 10');
  assert.equal(seen.open, true, '#15 and Enter opens a card past the first 10');
});

test("on a phone a long lane shows its first 5 cards and a Show all button, so Done's heading comes near the top (#220)", { skip: !findBrowser() && 'no browser here' }, async () => {
  const repo = mkdtempSync(join(tmpdir(), 'pm-phone-'));
  mkdirSync(join(repo, 'pm'));
  const cards = (from, n, word) => Array.from({ length: n }, (_, i) => `- #${from + i} ${word} card ${i} with a title long enough to take two lines · M1 · 2 pts\n  a line`).join('\n');
  writeFileSync(join(repo, 'pm', 'board.md'), `# Board\n<!-- next-id: 200 -->\n## Ideas\n${cards(1, 20, 'Idea')}\n## Up next\n${cards(30, 90, 'Next')}\n## Doing\n## Needs your look\n## Needs your decision\n## Done\n- #150 Done card · M1 · 2 pts\n`.replace('## Needs your look\n', `## Needs your look\n${Array.from({ length: 12 }, (_, i) => `- #${160 + i} Look ${i} · M1 · live 2026-10-01`).join('\n')}\n`));
  const { out } = buildProject(repo, new Date('2026-10-02T12:00:00.000Z'));
  const seen = await withPage(pathToFileURL(out).href, async (page) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1, mobile: true });
    await new Promise((ok) => setTimeout(ok, 300));
    const run = async (expression) => (await page.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    return run(`({ shown: [...document.querySelectorAll('.lane-up-next .card-x')].filter((li) => li.offsetParent).length,
      button: document.querySelector('.lane-up-next .lane-more').textContent,
      looks: [...document.querySelectorAll('.lane-waiting .card-x')].filter((li) => li.offsetParent).length,
      done: document.querySelector('.lane-done').getBoundingClientRect().top + scrollY })`);
  });
  assert.equal(seen.shown, 5);
  assert.equal(seen.button, 'Show all 90');
  assert.equal(seen.looks, 5, 'on a phone Waiting on you, first in the stack, is limited too');
  assert.ok(seen.done < 4 * 780, `Done's heading is near the top, not 90 cards down: at ${Math.round(seen.done)}px`);
});

test('on a 360px phone the tabs are one row that swipes, the header is short, and the first card is in the top half (#227)', { skip: !findBrowser() && 'no browser here' }, async () => {
  const repo = mkdtempSync(join(tmpdir(), 'pm-head-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), '# Board\n<!-- next-id: 4 -->\n## Ideas\n## Up next\n- #1 A card · M1 · 2 pts\n- #3 Another · M2 · 2 pts\n## Doing\n## Needs your look\n- #2 Look at it · M1 · live 2026-10-01\n## Needs your decision\n## Done\n');
  writeFileSync(join(repo, 'pm', 'plan.md'), '# Plan\n### M1 — Starts, respawns and the drones seen · in progress\nshort: Starts\n### M2 — Two · not started\n');
  const { out } = buildProject(repo, new Date('2026-10-02T12:00:00.000Z'));
  const seen = await withPage(pathToFileURL(out).href, async (page) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1, mobile: true });
    await new Promise((ok) => setTimeout(ok, 300));
    const expression = `(() => {
      const nav = document.querySelector('.dk-nav'), tabs = [...nav.querySelectorAll('a')];
      const title = document.querySelector('.header-title').getBoundingClientRect();
      const theme = document.querySelector('.header-right').getBoundingClientRect();
      return { rows: new Set(tabs.map((a) => Math.round(a.getBoundingClientRect().top))).size, tabs: tabs.length,
        swipes: getComputedStyle(nav).overflowX, pageWide: document.documentElement.scrollWidth,
        beside: theme.top < title.bottom, firstCard: document.querySelector('.lane-body .card-x').getBoundingClientRect().top };
    })()`;
    return (await page.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  });
  assert.equal(seen.tabs, 7);
  assert.equal(seen.rows, 1, 'the tabs are one row');
  assert.equal(seen.swipes, 'auto', 'which swipes sideways, so every tab is reachable');
  assert.ok(seen.pageWide <= 360, `the page itself does not scroll sideways: ${seen.pageWide}px`);
  assert.ok(seen.beside, 'Updated, ? and the theme button sit beside the title');
  assert.ok(seen.firstCard < 390, `the first card starts in the top half: at ${Math.round(seen.firstCard)}px`);
});

test('on a phone Ideas starts folded to its heading, and a tap opens it; desktop starts open (#231)', { skip: !findBrowser() && 'no browser here' }, async () => {
  const repo = mkdtempSync(join(tmpdir(), 'pm-ideas-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), '# Board\n<!-- next-id: 4 -->\n## Ideas\n- #1 An idea · M1\n## Up next\n- #2 Next · M1 · 2 pts\n## Doing\n## Needs your look\n## Needs your decision\n## Done\n- #3 Done · M1 · 1 pt\n');
  const { out } = buildProject(repo, new Date('2026-10-02T12:00:00.000Z'));
  const look = (width) => withPage(pathToFileURL(out).href, async (page) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: width < 600 });
    await page.send('Page.reload');
    await new Promise((ok) => setTimeout(ok, 500));
    const run = async (expression) => (await page.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    const state = () => run(`({ ideas: document.querySelector('.lane-ideas').classList.contains('folded'), done: document.querySelector('.lane-done').classList.contains('folded') })`);
    const before = await state();
    await run(`document.querySelector('.lane-ideas .lane-fold').click()`);
    return { before, after: await state() };
  });
  const phone = await look(360);
  assert.deepEqual(phone.before, { ideas: true, done: false }, 'on a phone Ideas starts folded, Done open');
  assert.equal(phone.after.ideas, false, 'a tap opens it');
  assert.deepEqual((await look(1400)).before, { ideas: false, done: false }, 'desktop starts with both open');
});

// #260: the open tab is marked for screen readers (aria-current), by a shape (a 3px bar),
// and in the window title; on a 360px phone the strip scrolls to it and fades only where
// more tabs wait.
const nap = (ms) => new Promise((ok) => setTimeout(ok, ms));
const tabState = `(() => {
  const on = [...document.querySelectorAll('.dk-nav a[aria-current="page"]')];
  return { on: on.map((a) => a.getAttribute('href')), title: document.title,
    bar: on[0] ? getComputedStyle(on[0], '::after').borderBottomWidth : '' };
})()`;

test('the open tab has aria-current, a 3px bar and its name in the window title, and follows the hash (#260)', { skip: !findBrowser() && 'no browser here' }, async () => {
  const repo = project('A card');
  writeFileSync(join(repo, 'pm', 'plan.md'), '# Plan\n### M1 — One · in progress\n');
  const { out } = buildProject(repo, new Date('2026-10-02T12:00:00.000Z'));
  const name = readFileSync(out, 'utf8').match(/<title>(.*?) - PM<\/title>/)[1];
  const seen = await withPage(pathToFileURL(out).href, async (page) => {
    const run = async (expression) => (await page.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    const at = async (hash) => { await run(`location.hash = ${JSON.stringify(hash)}`); await nap(150); return run(tabState); };
    return { start: await run(tabState), plan: await at('#plan'), ms: await at('#plan-M1'), settings: await at('#settings'), none: await at('') };
  });
  assert.deepEqual(seen.start.on, ['#board'], 'no hash: Board is the open tab');
  assert.equal(seen.start.title, `${name} - Board - PM`);
  assert.equal(seen.start.bar, '3px', 'the open tab carries a 3px bar, a shape and not colour alone');
  assert.deepEqual(seen.plan.on, ['#plan']);
  assert.equal(seen.plan.title, `${name} - Plan - PM`);
  assert.deepEqual(seen.ms.on, ['#plan'], 'a milestone on the Plan tab counts as Plan');
  assert.equal(seen.ms.title, `${name} - Plan - PM`);
  assert.deepEqual(seen.settings.on, ['#settings']);
  assert.equal(seen.settings.title, `${name} - Settings - PM`);
  assert.deepEqual(seen.none.on, ['#board'], 'back to no hash: Board again');
});

test('a hash that cannot be decoded (#%) marks Board, and later tab changes still mark the tab and title (#260)', { skip: !findBrowser() && 'no browser here' }, async () => {
  const repo = project('A card');
  const { out } = buildProject(repo, new Date('2026-10-02T12:00:00.000Z'));
  const name = readFileSync(out, 'utf8').match(/<title>(.*?) - PM<\/title>/)[1];
  const seen = await withPage(pathToFileURL(out).href + '#%', async (page) => {
    const run = async (expression) => (await page.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    const start = { hash: await run('location.hash'), ...(await run(tabState)) };
    await run(`location.hash = '#settings'`);
    await nap(150);
    return { start, settings: await run(tabState) };
  });
  assert.equal(seen.start.hash, '#%', 'the page really opened on #%');
  assert.deepEqual(seen.start.on, ['#board'], 'an undecodable hash counts as no target: Board');
  assert.deepEqual(seen.settings.on, ['#settings'], 'the hashchange listener is still there');
  assert.equal(seen.settings.title, `${name} - Settings - PM`);
});

test("the home page's open tab has aria-current and names the window (#260)", { skip: !findBrowser() && 'no browser here' }, async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'pm-home-tabs-')), 'index.html');
  buildHome({ root: mkdtempSync(join(tmpdir(), 'pm-home-root-')), out });
  const seen = await withPage(pathToFileURL(out).href, async (page) => {
    const run = async (expression) => (await page.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    const start = await run(tabState);
    await run(`location.hash = '#flow'`);
    await nap(150);
    return { start, flow: await run(tabState) };
  });
  assert.deepEqual(seen.start.on, ['#projects']);
  assert.equal(seen.start.title, 'Projects - PM');
  assert.deepEqual(seen.flow.on, ['#flow']);
  assert.equal(seen.flow.title, 'Session flow - PM');
});

test('on a 360px phone the open tab is scrolled into the strip, and each edge fades only where more tabs wait (#260)', { skip: !findBrowser() && 'no browser here' }, async () => {
  const repo = project('A card');
  const { out } = buildProject(repo, new Date('2026-10-02T12:00:00.000Z'));
  const seen = await withPage(pathToFileURL(out).href, async (page) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1, mobile: true });
    await nap(300);
    const run = async (expression) => (await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
    // Is the open tab's link wholly inside the strip's visible box?
    const inView = (hash) => run(`(async () => {
      document.querySelector('.dk-nav').scrollLeft = 0;
      location.hash = ${JSON.stringify(hash)};
      await new Promise((ok) => setTimeout(ok, 300));
      const nav = document.querySelector('.dk-nav').getBoundingClientRect();
      const a = document.querySelector('.dk-nav a[href="${hash}"]').getBoundingClientRect();
      return { inside: a.left >= nav.left - 0.5 && a.right <= nav.right + 0.5, a: [a.left, a.right], nav: [nav.left, nav.right] };
    })()`);
    // The two fades' widths at a scroll position (the registered --fade-start / --fade-end).
    const fades = (where) => run(`(async () => {
      const nav = document.querySelector('.dk-nav');
      nav.scrollLeft = ${where === 'start' ? 0 : 'nav.scrollWidth'};
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const s = getComputedStyle(nav);
      return { left: s.getPropertyValue('--fade-start').trim(), right: s.getPropertyValue('--fade-end').trim(), overflows: nav.scrollWidth > nav.clientWidth };
    })()`);
    const settings = await inView('#settings');
    const links = await inView('#links');
    // Load straight onto #settings too: the script runs on load, not only on hashchange.
    await run(`location.hash = '#settings'`);
    await page.send('Page.reload');
    await nap(500);
    const loaded = await run(`(() => { const nav = document.querySelector('.dk-nav').getBoundingClientRect(), a = document.querySelector('.dk-nav a[href="#settings"]').getBoundingClientRect(); return a.left >= nav.left - 0.5 && a.right <= nav.right + 0.5; })()`);
    return { settings, links, loaded, start: await fades('start'), end: await fades('end') };
  });
  assert.ok(seen.settings.inside, `Settings is in the strip's view: ${JSON.stringify(seen.settings)}`);
  assert.ok(seen.links.inside, `Links is in the strip's view: ${JSON.stringify(seen.links)}`);
  assert.ok(seen.loaded, 'a page opened on #settings shows Settings in the strip');
  assert.ok(seen.start.overflows, 'at 360px the strip has more tabs than fit');
  assert.equal(seen.start.left, '0px', 'at the start, no fade on the left');
  assert.equal(seen.start.right, '32px', 'at the start, the right edge fades');
  assert.equal(seen.end.left, '32px', 'at the end, the left edge fades');
  assert.equal(seen.end.right, '0px', 'at the end, no fade on the right');
});
