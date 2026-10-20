import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import './isolate.js';
import { FULL_MAX, findBrowser, findShell, isLocal, parseShotArgs, takeShots } from '../src/shots.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'pm-shots-test-'));

test('uses the newest headless Chromium that Playwright left behind', () => {
  const cache = tmp();
  for (const build of ['chromium_headless_shell-1228', 'chromium_headless_shell-1234', 'chromium-1300']) {
    mkdirSync(join(cache, build, 'chrome-headless-shell-linux64'), { recursive: true });
    writeFileSync(join(cache, build, 'chrome-headless-shell-linux64', 'chrome-headless-shell'), '');
  }
  assert.equal(findShell(cache), join(cache, 'chromium_headless_shell-1234', 'chrome-headless-shell-linux64', 'chrome-headless-shell'));
  assert.equal(findShell(tmp()), null);
  assert.equal(findShell(join(cache, 'missing')), null);
});

test('finds a browser on Linux and on a Mac, and nothing is an answer too', () => {
  const file = (...path) => (mkdirSync(join(...path.slice(0, -1)), { recursive: true }), writeFileSync(join(...path), ''), join(...path));
  const none = { env: { PATH: '' }, home: tmp(), apps: tmp() };
  assert.equal(findBrowser(none), null, 'a machine with no browser');

  const mac = tmp();
  const shell = file(mac, 'Library', 'Caches', 'ms-playwright', 'chromium_headless_shell-1234', 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
  assert.equal(findBrowser({ ...none, home: mac }), shell, "Playwright's shell in a Mac's cache");

  const bin = tmp();
  const brave = file(bin, 'brave-browser');
  assert.equal(findBrowser({ ...none, env: { PATH: `/nowhere:${bin}` } }), brave, 'a browser on the PATH');
  const chrome = file(bin, 'google-chrome');
  assert.equal(findBrowser({ ...none, env: { PATH: bin } }), chrome, 'Chrome before Brave');

  const apps = tmp();
  const app = file(apps, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome');
  assert.equal(findBrowser({ ...none, apps }), app, 'a Mac app');

  assert.equal(findBrowser({ ...none, home: mac, env: { PATH: bin, SOLOAGILE_BROWSER: brave } }), brave, 'the one SOLOAGILE_BROWSER names comes first');
  assert.equal(findBrowser({ ...none, home: mac, env: { SOLOAGILE_BROWSER: join(bin, 'gone') } }), null, 'and a wrong one is not papered over');
});

// A page that follows the system's light or dark setting, like most sites, and one that
// follows a stored choice, like the pm pages.
const PAGE = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body { background: #fff; } @media (prefers-color-scheme: dark) { body { background: #000; } }</style>
<script>if (location.search === '?stored' && localStorage.getItem('pm-theme')) document.documentElement.style.background = localStorage.getItem('pm-theme') === 'light' ? '#fff' : '#000', document.documentElement.style.colorScheme = 'only light';</script>
<body>hello`;

// PNG: the width and height are the two big-endian numbers after the IHDR tag.
const size = (file) => {
  const png = readFileSync(file);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
};

test('takes four screenshots: desktop and phone width, dark and light', { skip: !findBrowser() && 'no headless Chromium here' }, async () => {
  const server = createServer((req, res) => res.end(PAGE)).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const files = await takeShots(url, tmp());
    assert.deepEqual(files.map((f) => basename(f)), ['desktop-dark.png', 'desktop-light.png', 'phone-dark.png', 'phone-light.png']);
    assert.deepEqual(files.map(size), [[1400, 900], [1400, 900], [360, 780], [360, 780]]);
    const [dark, light] = files.map((f) => readFileSync(f));
    assert.notDeepEqual(dark, light, 'dark and light differ on a page that follows the system setting');
    const stored = await takeShots(`${url}?stored`, tmp());
    assert.notDeepEqual(readFileSync(stored[0]), readFileSync(stored[1]), 'and on a page that follows a stored choice');
    const tab = await takeShots(`${url}#flow`, tmp());
    assert.equal(tab.length, 4, 'an address with a # part loads afresh for every shot');
    assert.notDeepEqual(readFileSync(tab[0]), readFileSync(tab[1]));
  } finally {
    server.close();
  }
});

test('reads the clicks and typing to do before the picture, in the order written', () => {
  assert.deepEqual(parseShotArgs(['http://x/']), { url: 'http://x/', dir: undefined, steps: [] });
  assert.deepEqual(parseShotArgs(['http://x/', '--type', 'Search=a=b', 'out', '--click', 'Go']), {
    url: 'http://x/',
    dir: 'out',
    steps: [{ do: 'type', what: 'Search', text: 'a=b' }, { do: 'click', what: 'Go' }],
  });
  assert.deepEqual(parseShotArgs(['--full', 'http://x/', '--click', 'Plan']), {
    url: 'http://x/',
    dir: undefined,
    steps: [{ do: 'click', what: 'Plan' }, { do: 'full' }],
  }, '--full can go anywhere, and is done last');
  for (const bad of [[], ['--full'], ['--click', 'Go'], ['http://x/', '--click'], ['http://x/', '--type', 'no box'], ['http://x/', '--tap', 'Go'], ['a', 'b', 'c']]) {
    assert.throws(() => parseShotArgs(bad), /usage: soloagile shots/, bad.join(' '));
  }
});

// A page with a pop-up to open, a box to fill in and a button that sends what was typed.
const FORM = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<body style="background:#fff">
<button popovertarget="menu">Open the menu</button>
<div id="menu" popover style="inset:0;width:100%;height:100%;background:#c00">menu</div>
<label>Search <input id="q" value="old"></label>
<select aria-label="Room"><option>Any</option><option>Kitchen</option></select>
<button onclick="fetch('/went?q=' + q.value + '&room=' + document.querySelector('select').value)">Go</button>
<div style="height:3000px"></div>
<a href="#" class="low" onclick="fetch('/low')">Far down the page</a>`;

test('clicks and types before each picture', { skip: !findBrowser() && 'no headless Chromium here' }, async () => {
  const asked = [];
  const server = createServer((req, res) => {
    // An ordinary browser also asks for the site's icon; the headless shell doesn't.
    if (req.url !== '/' && req.url !== '/favicon.ico') asked.push(req.url);
    res.end(req.url === '/' ? FORM : '');
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const plain = await takeShots(url, tmp());
    await takeShots(url, tmp(), [
      { do: 'type', what: 'Search', text: 'kitchen' },
      { do: 'type', what: 'room', text: 'Kitchen' },
      { do: 'click', what: 'go' },
      { do: 'click', what: '.low' },
    ]);
    assert.deepEqual(asked, Array(4).fill(['/went?q=kitchen&room=Kitchen', '/low']).flat(), 'the typed text replaced what the box held, in all four pictures');
    const opened = await takeShots(url, tmp(), [{ do: 'click', what: 'Open the menu' }]);
    for (const i of [0, 2]) assert.notDeepEqual(readFileSync(opened[i]), readFileSync(plain[i]), 'the pop-up is in the picture, at desktop and phone width');
    await assert.rejects(takeShots(url, tmp(), [{ do: 'click', what: 'Nope' }]), /nothing to click named "Nope"\. The page has: open the menu, search, go, far down the page/);
    await assert.rejects(takeShots(url, tmp(), [{ do: 'type', what: 'Room', text: 'Attic' }]), /"Room" has no choice "Attic"/);
    await assert.rejects(takeShots(url, tmp(), [{ do: 'click', what: 'Open the menu' }, { do: 'click', what: 'Go' }]), /"Go" can't be clicked: something else covers it/);
  } finally {
    server.close();
  }
});

test('a page on this machine or its network is local; one from the internet is not', () => {
  for (const url of ['file:///home/me/pm/index.html', 'http://localhost:3000/', 'http://127.0.0.1/', 'http://[::1]:8080/', 'http://192.168.0.10/x/', 'http://10.1.2.3/', 'http://172.20.0.1/', 'http://100.101.1.2/', 'http://desk/x/', 'http://nas.local/']) {
    assert.ok(isLocal(url), url);
  }
  for (const url of ['https://example.com/', 'http://8.8.8.8/', 'http://172.32.0.1/', 'http://100.128.0.1/', 'not a url', 'javascript:alert(1)']) {
    assert.ok(!isLocal(url), url);
  }
});

// A browser that can't start sandboxed: it writes down how it was started, then exits.
function unsandboxable() {
  const dir = tmp();
  const bin = join(dir, 'browser');
  writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${join(dir, 'starts')}"\nexit 1\n`);
  chmodSync(bin, 0o755);
  return { bin, starts: () => readFileSync(join(dir, 'starts'), 'utf8').trim().split('\n') };
}

test('the browser starts with its sandbox on, and goes without it only for a local page', async () => {
  const local = unsandboxable();
  await assert.rejects(takeShots('file:///tmp/page.html', tmp(), [], local.bin), /closed before it was ready/);
  assert.deepEqual(local.starts().map((s) => s.includes('--no-sandbox')), [false, true]);

  const remote = unsandboxable();
  await assert.rejects(takeShots('https://example.com/', tmp(), [], remote.bin), /isn't opened without one/);
  assert.deepEqual(remote.starts().map((s) => s.includes('--no-sandbox')), [false]);
});

test('--full takes the whole height of the page, up to FULL_MAX', { skip: !findBrowser() && 'no headless Chromium here' }, async () => {
  const tall = (px) => `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0"><div style="height:${px}px"></div>`;
  const server = createServer((req, res) => res.end(tall(req.url === '/huge' ? FULL_MAX + 4000 : 3000))).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const files = await takeShots(url, tmp(), [{ do: 'full' }]);
    assert.deepEqual(files.map(size), [[1400, 3000], [1400, 3000], [360, 3000], [360, 3000]]);
    const huge = await takeShots(`${url}huge`, tmp(), [{ do: 'full' }]);
    assert.deepEqual(huge.map(size).map(([, h]) => h), Array(4).fill(FULL_MAX), 'a very tall page stops at FULL_MAX');
  } finally {
    server.close();
  }
});
