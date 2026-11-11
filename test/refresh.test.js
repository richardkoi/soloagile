import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import './isolate.js';
import { buildProject } from '../src/build.js';
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
      return { shown: s.hidden ? '' : s.textContent, fits: s.hidden || s.getBoundingClientRect().right <= c.getBoundingClientRect().right - parseFloat(getComputedStyle(c).paddingRight) - parseFloat(getComputedStyle(c).borderRightWidth) + 0.01, title: c.title };
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
  assert.equal(long.title, 'M1 Starts, respawns and the drones seen', 'the whole name on hover');
});
