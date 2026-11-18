// #257: the desktop header is two slim rows (under 12% of a 1400×900 window), and a card
// reached by Tab is scrolled clear of it by html's scroll-padding-top.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import './isolate.js';
import { buildProject } from '../src/build.js';
import { findBrowser, withPage } from '../src/shots.js';

const head = readFileSync(fileURLToPath(new URL('../template/head.html', import.meta.url)), 'utf8');
// The desktop-only blocks: everything inside @media (min-width: 701px) ... rules.
const desktop = [...head.matchAll(/@media \(min-width: 701px\)[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');

test('on desktop, html keeps a header-high band clear at the top for focused and targeted elements (#257)', () => {
  assert.match(desktop, /html\s*\{\s*scroll-padding-top:\s*calc\(var\(--header-h\)/, 'scroll-padding-top comes from the header height');
  assert.match(desktop, /--header-h:\s*\d+px/, 'the header height is set for desktop');
});

test('the desktop header is a two-row grid: title and subtitle on one line, tabs under it (#257)', () => {
  assert.match(desktop, /\.header\s*\{[^}]*display:\s*grid[^}]*grid-template-areas:\s*"title right"\s*"nav right"/);
  assert.match(desktop, /\.header-left\s*>\s*div\s*\{[^}]*display:\s*flex/, 'title and subtitle side by side');
  assert.match(desktop, /\.header-subtitle\s*\{[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/, 'a long subtitle ends in … rather than wrapping');
});

function bigBoard() {
  const repo = mkdtempSync(join(tmpdir(), 'pm-header-'));
  mkdirSync(join(repo, 'pm'));
  const cards = (from, n, word) => Array.from({ length: n }, (_, i) => `- #${from + i} ${word} card ${i} · M1 · 2 pts\n  a line`).join('\n');
  writeFileSync(join(repo, 'pm', 'board.md'), `# Board\n<!-- next-id: 200 -->\n## Ideas\n${cards(1, 40, 'Idea')}\n## Up next\n${cards(50, 40, 'Next')}\n## Doing\n## Needs your look\n## Needs your decision\n## Done\n${cards(100, 40, 'Done')}\n`);
  writeFileSync(join(repo, 'pm', 'plan.md'), '# Plan\n### M1 — Working on a long milestone name to fill the subtitle line · in progress\n');
  return buildProject(repo, new Date('2026-10-02T12:00:00.000Z')).out;
}

test('on a 1400×900 desktop the header is under 108px, and a card reached by Tab sits below it (#257)', { skip: !findBrowser() && 'no browser here' }, async () => {
  const out = bigBoard();
  const seen = await withPage(pathToFileURL(out).href, async (page) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.reload');
    await new Promise((ok) => setTimeout(ok, 500));
    const run = async (expression) => (await page.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    const header = await run(`document.querySelector('header.header').getBoundingClientRect().height`);
    // Tab from one card to the next while the next card sits just under the header, as it
    // does when Tab moves along a lane the page has been scrolled past. The browser only
    // scrolls it into view if it knows the header covers that band (scroll-padding-top).
    await run(`(() => {
      const cards = [...document.querySelectorAll('.lane-up-next .card-x')];
      cards[4].querySelector('.card-open').focus({ preventScroll: true });
      window.scrollBy(0, cards[5].getBoundingClientRect().top - 40);
    })()`);
    await new Promise((ok) => setTimeout(ok, 200));
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await new Promise((ok) => setTimeout(ok, 300));
    const focus = await run(`(() => {
      const card = document.activeElement.closest('.card-x');
      const head = document.querySelector('header.header').getBoundingClientRect();
      return { id: card && card.dataset.id, cardTop: card && card.getBoundingClientRect().top, headBottom: head.bottom };
    })()`);
    return { header, ...focus };
  });
  assert.equal(seen.id, '55', 'Tab reached the next card in the lane');
  assert.ok(seen.header < 108, `the header is under 12% of 900px: ${Math.round(seen.header)}px`);
  assert.ok(seen.cardTop >= seen.headBottom, `the focused card's top (${Math.round(seen.cardTop)}px) is below the header's bottom (${Math.round(seen.headBottom)}px)`);
});
