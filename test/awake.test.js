// The Awake button: a screen wake lock each browser remembers, like the theme, so the
// computer doesn't sleep through a long session while the page shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import './isolate.js';
import { buildProject } from '../src/build.js';
import { findBrowser, withPage } from '../src/shots.js';

const skip = !findBrowser() && 'no browser here';

function pageUrl() {
  const repo = mkdtempSync(join(tmpdir(), 'pm-awake-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), '# Board\n<!-- next-id: 2 -->\n## Ideas\n## Up next\n- #1 A card · M1 · 2 pts\n  done when: it shows\n## Doing\n## Needs your look\n## Needs your decision\n## Done\n');
  return pathToFileURL(buildProject(repo).out).href;
}

// What the button and the page say: pressed, a lock held, the button shown, and its title.
const STATE = `(() => { const b = document.querySelector('.awake');
  return { pressed: b.getAttribute('aria-pressed'), held: document.documentElement.hasAttribute('data-awake-held'), shown: b.getClientRects().length > 0, title: b.title }; })()`;

function driver(page) {
  const run = async (expression) => (await page.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  // The lock comes back from the browser a moment after it is asked for.
  const until = async (held) => {
    for (let i = 0; i < 40; i++) {
      const s = await run(STATE);
      if (s.held === held) return s;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    return run(STATE);
  };
  const reload = async () => {
    const loaded = page.once('Page.loadEventFired');
    await page.send('Page.reload');
    await loaded;
  };
  return { run, until, reload, click: () => run("document.querySelector('.awake').click()") };
}

test('Awake holds a wake lock while the page shows, takes it again after a reload, and lets go when switched off', { skip }, async () => {
  await withPage(pageUrl(), async (page) => {
    // A browser run by DevTools refuses the lock unless told otherwise; a person's grants it.
    await page.send('Browser.grantPermissions', { permissions: ['wakeLockScreen'] });
    const p = driver(page);
    assert.deepEqual(await p.run(STATE), { pressed: 'false', held: false, shown: true, title: 'Keep the screen awake while this page shows' }, 'off until this browser turns it on');
    await p.click();
    assert.deepEqual(await p.until(true), { pressed: 'true', held: true, shown: true, title: 'Keeping the screen awake while this page shows' });
    // Each rebuild reloads the page, which lets the lock go; the page remembers and takes it again.
    await p.reload();
    assert.deepEqual(await p.until(true), { pressed: 'true', held: true, shown: true, title: 'Keeping the screen awake while this page shows' });
    await p.click();
    assert.deepEqual(await p.until(false), { pressed: 'false', held: false, shown: true, title: 'Keep the screen awake while this page shows' });
    await p.reload();
    assert.equal((await p.run(STATE)).pressed, 'false', 'off stays off');
  });
});

test('a browser that refuses the lock is named on the button, which stays pressed', { skip }, async () => {
  await withPage(pageUrl(), async (page) => {
    const p = driver(page);
    await p.click();
    for (let i = 0; i < 40 && !(await p.run(STATE)).title.startsWith('The browser would not'); i++) await new Promise((ok) => setTimeout(ok, 100));
    const s = await p.run(STATE);
    assert.equal(s.pressed, 'true');
    assert.equal(s.held, false);
    assert.match(s.title, /^The browser would not keep the screen awake: \S/);
  });
});

test('with no wake lock in the browser, as over plain http, the button is hidden', { skip }, async () => {
  await withPage(pageUrl(), async (page) => {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.wakeLock;' });
    const p = driver(page);
    await p.reload();
    assert.equal(await p.run("'wakeLock' in navigator"), false);
    assert.equal(await p.run('document.documentElement.dataset.awake'), 'none');
    assert.equal((await p.run(STATE)).shown, false);
  });
});
