// The theme (#258): a new viewer gets the computer's light or dark setting, the page carries
// a color-scheme meta tag, and the header's theme button offers Light, Dark and System.
// System removes the saved "pm-theme", which `soloagile shots` sets to take its pictures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import './isolate.js';
import { buildProject, readProject, readTemplate } from '../src/build.js';
import { renderPage } from '../src/page.js';
import { renderHome } from '../src/home.js';
import { findBrowser, withPage } from '../src/shots.js';

const builtAt = new Date(2026, 10, 18, 14, 45);
const starter = readProject(join(dirname(fileURLToPath(import.meta.url)), '..', 'starter'));
const page = renderPage({ name: 'demo', md: starter.md, builtAt, template: readTemplate('page.html') }).html;
const home = renderHome({ projects: [], builtAt, template: readTemplate('home.html') }).html;

// Runs the page's first script (the early one in the head) against a stub browser, with
// `saved` as this browser's stored pm-theme. Returns the stubs so a test can look at them.
function runEarly(saved) {
  const store = new Map(saved == null ? [] : [['pm-theme', saved]]);
  const meta = { content: 'light dark' };
  const root = { dataset: {}, toggleAttribute() {} };
  const listeners = {};
  const sandbox = {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: { documentElement: root, hidden: false, querySelector: (s) => (s === 'meta[name="color-scheme"]' ? meta : null), addEventListener() {} },
    navigator: {},
    window: { addEventListener: (type, fn) => { listeners[type] = fn; } },
  };
  vm.runInNewContext(page.match(/<script>([^]*?)<\/script>/)[1], sandbox);
  return { store, meta, root, listeners, sandbox };
}

test('a new viewer gets the computer\'s theme: <html> carries no data-theme, and the early script sets it only from a saved pm-theme', () => {
  for (const html of [page, home]) assert.match(html, /<html lang="en">/);
  const fresh = runEarly(null);
  assert.equal(fresh.root.dataset.theme, undefined, 'nothing saved: the CSS follows the computer');
  assert.equal(fresh.meta.content, 'light dark');
  assert.equal(runEarly('light').root.dataset.theme, 'light');
  assert.equal(runEarly('dark').root.dataset.theme, 'dark');
  assert.equal(runEarly('dark').meta.content, 'dark', 'the meta tag follows the choice');
  assert.equal(runEarly('purple').root.dataset.theme, undefined, 'an unknown value reads as System');
  // The CSS: the root follows the computer and never pins dark by default.
  assert.match(page, /:root \{[^}]*color-scheme: light dark;/);
  assert.doesNotMatch(page, /:root, \[data-theme="dark"\]/);
});

test('the built project page and the home page carry <meta name="color-scheme" content="light dark">', () => {
  for (const html of [page, home]) {
    const head = html.match(/<head>[^]*?<\/head>/)[0];
    assert.match(head, /<meta name="color-scheme" content="light dark">/);
    assert.ok(head.indexOf('name="color-scheme"') < head.indexOf('<script>'), 'before the early script, which updates it');
  }
});

test('the theme button offers Light, Dark and System, and System removes the saved pm-theme', () => {
  for (const html of [page, home]) {
    const header = html.match(/<header class="header">[^]*?<\/header>/)[0];
    assert.match(header, /<button class="btn btn-ghost theme-btn" type="button" popovertarget="theme-menu">/);
    const menu = header.match(/<div class="theme-menu" id="theme-menu" popover>[^]*?<\/div>/)[0];
    assert.match(menu, /<legend>Theme<\/legend>/);
    assert.deepEqual([...menu.matchAll(/type="radio" name="pm-theme-pick" value="(\w+)"/g)].map((m) => m[1]), ['light', 'dark', 'system']);
  }
  const b = runEarly('dark');
  b.sandbox.setTheme('system');
  assert.equal(b.store.has('pm-theme'), false, 'System removes pm-theme');
  assert.equal(b.root.dataset.theme, undefined);
  assert.equal(b.meta.content, 'light dark');
  b.sandbox.setTheme('light');
  assert.equal(b.store.get('pm-theme'), 'light', 'Light and Dark are stored as they are');
  // Another open tab changes the choice: this one follows.
  b.store.set('pm-theme', 'dark');
  b.listeners.storage({ key: 'pm-theme' });
  assert.equal(b.root.dataset.theme, 'dark');
});

test('in a browser: the page follows the computer, Dark pins it, and System lets it follow again (#258)', { skip: !findBrowser() && 'no browser here' }, async () => {
  const repo = mkdtempSync(join(tmpdir(), 'pm-theme-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), '# Board\n<!-- next-id: 2 -->\n## Ideas\n## Up next\n- #1 A card · M1\n## Doing\n## Needs your look\n## Needs your decision\n## Done\n');
  const { out } = buildProject(repo, builtAt);
  const seen = await withPage(pathToFileURL(out).href, async (page) => {
    const run = async (expression) => (await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
    const system = (value) => page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
    const state = `({ bg: getComputedStyle(document.body).backgroundColor, word: [...document.querySelectorAll('.theme-word')].filter((w) => w.offsetParent).map((w) => w.textContent).join(),
      name: document.querySelector('.theme-btn').innerText.replace(/\\s+/g, ' ').trim(), saved: localStorage.getItem('pm-theme'),
      checked: document.querySelector('#theme-menu input:checked').value, meta: document.querySelector('meta[name="color-scheme"]').content,
      now: [...document.querySelectorAll('.theme-now > span')].filter((w) => getComputedStyle(w).display !== 'none').map((w) => w.textContent).join() })`;
    const pick = (v) => run(`document.querySelector('#theme-menu input[value="${v}"]').click()`);
    const r = {};
    await system('light'); r.light = await run(state);
    await system('dark'); r.dark = await run(state);
    await run(`document.querySelector('.theme-btn').click(); new Promise((ok) => setTimeout(ok, 50))`);
    r.focus = await run(`({ open: document.querySelector('#theme-menu').matches(':popover-open'), focused: document.activeElement.value })`);
    await pick('dark'); await system('light'); r.pinned = await run(state);
    await pick('system'); r.back = await run(state);
    return r;
  });
  assert.equal(seen.light.bg, 'rgb(245, 237, 224)', 'a computer set to light: the page is light');
  assert.equal(seen.dark.bg, 'rgb(13, 16, 13)', 'a computer set to dark: the page is dark');
  assert.equal(seen.dark.word, 'System', 'the button says the choice');
  assert.equal(seen.dark.name, 'Theme: System', 'and its name says what it is');
  assert.equal(seen.dark.checked, 'system');
  assert.equal(seen.dark.now, 'dark now', 'System says what the computer is set to');
  assert.deepEqual(seen.focus, { open: true, focused: 'system' }, 'opening the list puts focus on the chosen radio');
  assert.equal(seen.pinned.bg, 'rgb(13, 16, 13)', 'Dark stays dark while the computer is light');
  assert.equal(seen.pinned.saved, 'dark');
  assert.equal(seen.pinned.meta, 'dark');
  assert.equal(seen.pinned.word, 'Dark');
  assert.equal(seen.back.saved, null, 'System removes pm-theme');
  assert.equal(seen.back.bg, 'rgb(245, 237, 224)', 'and the page follows the computer again');
  assert.equal(seen.back.meta, 'light dark');
  assert.equal(seen.back.word, 'System');
  assert.equal(seen.back.now, 'light now');
});
