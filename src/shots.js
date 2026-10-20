// `soloagile shots <url>`: four screenshots of a page with nobody watching, for the wheel's Test
// stage: desktop and phone width, each in dark and light. Claude reads the pictures.
//
// Steps given with --click, --type and --press run first, in order, on every one of the four,
// so a pop-up can be opened or a box filled in and Enter pressed before the picture. With --full each picture is the
// whole height of the page, not only the top, up to FULL_MAX pixels.
//
// It drives a headless browser (findBrowser: Playwright's headless Chromium, or a Chrome,
// Chromium, Edge or Brave already on the machine), over the DevTools protocol with Node's
// built-in WebSocket, so this repo still has no npm dependencies. An ordinary browser window can't shrink to phone width, so it is headless.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, join } from 'node:path';

export const VIEWS = [
  { name: 'desktop', width: 1400, height: 900, mobile: false },
  { name: 'phone', width: 360, height: 780, mobile: true }, // a small phone
];
export const THEMES = ['dark', 'light'];
const TIMEOUT_MS = 20000;
// How long a click or typed text is given to show on the page before the next step.
const SETTLE_MS = 300;
// The keys --press knows by name, as the DevTools protocol wants them. Any one character
// works too. Enter carries "\r" as its text so a form is sent, as a real key would.
const KEYS = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Escape: { code: 'Escape', keyCode: 27 },
  Tab: { code: 'Tab', keyCode: 9 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
};
const keyFor = (name) => KEYS[name] ? { key: name, ...KEYS[name] }
  : { key: name, text: name, keyCode: name.toUpperCase().charCodeAt(0) };

// The tallest a --full picture goes. A taller page is cut off there, and shots says so.
export const FULL_MAX = 16000;

// `soloagile shots <url> [dir] [--click <words>] [--type <box>=<text>] [--press <key>] ... [--full]` -> { url, dir, steps }.
// The steps keep the order they were written in. --full comes back as one more step,
// { do: 'full' }, at the end: it is the last thing done before each picture.
export function parseShotArgs(args) {
  const usage = new Error('usage: soloagile shots <url> [dir] [--click "<words on it>"] [--type "<box>=<text>"] [--press <key>] ... [--full]');
  let full = false;
  const plain = [];
  const steps = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--click' || args[i] === '--type' || args[i] === '--press') {
      const value = args[++i];
      if (!value) throw usage;
      if (args[i - 1] === '--press') {
        if (!KEYS[value] && [...value].length !== 1) throw new Error(`${usage.message}\n--press takes one character or a key: ${Object.keys(KEYS).join(', ')}`);
        steps.push({ do: 'press', what: value });
      } else if (args[i - 1] === '--click') {
        steps.push({ do: 'click', what: value });
      } else {
        const at = value.indexOf('=');
        if (at < 1) throw usage;
        steps.push({ do: 'type', what: value.slice(0, at), text: value.slice(at + 1) });
      }
    } else if (args[i] === '--full') {
      full = true;
    } else if (args[i].startsWith('--')) {
      throw usage;
    } else {
      plain.push(args[i]);
    }
  }
  if (plain.length < 1 || plain.length > 2) throw usage;
  if (full) steps.push({ do: 'full' });
  return { url: plain[0], dir: plain[1], steps };
}

// The newest chromium_headless_shell-<build> in Playwright's cache, or null. The cache is
// in ~/.cache on Linux and ~/Library/Caches on a Mac, and the folder inside names the system.
export function findShell(cache) {
  if (!existsSync(cache)) return null;
  const build = (dir) => Number(dir.split('-')[1]);
  const dirs = readdirSync(cache).filter((d) => /^chromium_headless_shell-\d+$/.test(d)).sort((a, b) => build(b) - build(a));
  for (const dir of dirs) {
    for (const system of readdirSync(join(cache, dir)).filter((d) => d.startsWith('chrome-headless-shell-'))) {
      const bin = join(cache, dir, system, 'chrome-headless-shell');
      if (existsSync(bin)) return bin;
    }
  }
  return null;
}

// Browsers a machine may already have, in the order tried: by name on the PATH, then as Mac apps.
const INSTALLED = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'];
const MAC_APPS = ['Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser'];

// The browser `shots` and `design` drive, or null: the one SOLOAGILE_BROWSER names, then
// Playwright's headless shell, then a Chromium-family browser already on the machine.
// `env`, `home` and `apps` are only overridden by the tests.
export function findBrowser({ env = process.env, home = homedir(), apps = '/Applications' } = {}) {
  if (env.SOLOAGILE_BROWSER) return existsSync(env.SOLOAGILE_BROWSER) ? env.SOLOAGILE_BROWSER : null;
  const shell = findShell(join(home, '.cache', 'ms-playwright')) ?? findShell(join(home, 'Library', 'Caches', 'ms-playwright'));
  if (shell) return shell;
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const name of INSTALLED) if (existsSync(join(dir, name))) return join(dir, name);
  }
  for (const app of MAC_APPS) {
    const bin = join(apps, `${app}.app`, 'Contents', 'MacOS', app);
    if (existsSync(bin)) return bin;
  }
  return null;
}
const NO_BROWSER = 'no browser found. Install Chrome or Chromium, or run: npx playwright install chromium-headless-shell. Or set SOLOAGILE_BROWSER to a Chromium-family browser.';

const timeout = (promise, what) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), TIMEOUT_MS).unref())]);

// Starts the browser and resolves with its DevTools address, which it prints on stderr.
function launch(bin, profile, sandbox) {
  // Playwright's shell is headless by nature; an ordinary browser has to be told.
  const headless = basename(bin) === 'chrome-headless-shell' ? [] : ['--headless=new', '--no-first-run'];
  const child = spawn(bin, [...headless, '--remote-debugging-port=0', ...(sandbox ? [] : ['--no-sandbox']), '--hide-scrollbars', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  const ws = new Promise((resolve, reject) => {
    let err = '';
    child.stderr.on('data', (chunk) => {
      err += chunk;
      const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]);
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('the browser closed before it was ready')));
  });
  return { child, ws };
}

// Is the page on this machine or its own network? A file, localhost, a private address, or
// a one-word machine name such as http://desk/.
export function isLocal(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'file:' || u.protocol === 'about:') return true;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' || host === '::1' || host.endsWith('.local') || !host.includes('.') ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host)
  );
}

// Starts the browser with its sandbox on. Some can't: Playwright's headless shell on Ubuntu
// is refused by the system's rules. Those run without the sandbox only for a page on this
// machine or its network, never for one from the internet. Returns { child, address }.
async function startBrowser(bin, url, profile) {
  for (const sandbox of [true, false]) {
    if (!sandbox && !isLocal(url)) {
      throw new Error(`${basename(bin)} can't start with its sandbox on, and ${url} is not on this machine, so it isn't opened without one. Install Chrome or Chromium, or set SOLOAGILE_BROWSER to one.`);
    }
    const { child, ws } = launch(bin, profile, sandbox);
    try {
      return { child, address: await timeout(ws, 'the browser to start') };
    } catch (err) {
      await stop(child);
      if (!sandbox) throw err;
    }
  }
}

// Stops the browser and everything it started. A browser on the PATH is often a small
// script that starts the real one, so stopping that script alone would leave the browser
// running. It is launched as its own process group (detached), and the whole group is stopped.
// It waits for the browser to go: one still closing writes its profile back after the
// folder is removed. A browser that won't close in STOP_MS is killed.
const STOP_MS = 2000;
async function stop(child) {
  const signal = (name) => {
    try {
      process.kill(-child.pid, name);
    } catch {
      child.kill(name);
    }
  };
  const gone = new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', resolve)));
  signal('SIGTERM');
  const kill = setTimeout(() => signal('SIGKILL'), STOP_MS);
  await gone;
  clearTimeout(kill);
  child.stderr.destroy();
  child.unref();
}

// A minimal DevTools client: send(method, params) resolves with the reply, and
// once(event) with the next event of that name.
async function connect(address) {
  const ws = new WebSocket(address);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('could not reach the browser'));
  });
  let id = 0;
  let sessionId;
  const replies = new Map();
  const waiting = new Map();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id) {
      const { resolve, reject } = replies.get(msg.id);
      replies.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (waiting.has(msg.method)) {
      waiting.get(msg.method)();
      waiting.delete(msg.method);
    }
  };
  const send = (method, params = {}) =>
    timeout(new Promise((resolve, reject) => {
      replies.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    }), method);
  const once = (event) => timeout(new Promise((resolve) => waiting.set(event, resolve)), event);
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  return { send, once, close: () => ws.close() };
}

// Opens an address and waits for it to finish loading.
async function open(page, url) {
  const loaded = page.once('Page.loadEventFired');
  const { errorText } = await page.send('Page.navigate', { url });
  if (errorText) throw new Error(`could not open ${url}: ${errorText}`);
  await loaded;
}

// Runs inside the page: finds what a step names and scrolls it into view. A click is named
// by the words on it and a box by its label, in both cases exactly or else in part; failing
// that, the name is tried as a CSS selector. Returns the point to click, or `done` once a
// box is ready for its text, or an `error` that lists what the page does offer.
function locate({ kind, what, text }) {
  const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const want = norm(what);
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const CLICKS = 'button, a, summary, label, input[type=button], input[type=submit], input[type=checkbox], input[type=radio], [role=button], [role=tab], [role=menuitem], [role=link], [onclick], [popovertarget]';
  const BOXES = 'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=""], [contenteditable=true]';
  const names = kind === 'click'
    ? (el) => [el.innerText, el.value, el.getAttribute('aria-label'), el.title]
    : (el) => [...[...(el.labels ?? [])].map((l) => l.innerText), el.getAttribute('aria-label'), el.placeholder, el.name, el.id];
  const all = [...document.querySelectorAll(kind === 'click' ? CLICKS : BOXES)].filter(shown);
  const named = (test) => all.find((el) => names(el).some((n) => norm(n) && test(norm(n))));
  let el = named((n) => n === want) ?? named((n) => n.includes(want));
  if (!el) {
    try {
      el = [...document.querySelectorAll(what)].find(shown);
    } catch {} // not a selector, so only its words could have matched
  }
  if (!el) {
    const offers = [...new Set(all.map((e) => names(e).map(norm).find(Boolean)).filter(Boolean))].slice(0, 12);
    return { error: `nothing to ${kind === 'click' ? 'click' : 'type in'} named "${what}"${offers.length ? `. The page has: ${offers.join(', ')}` : ''}` };
  }
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  if (kind === 'click') {
    const r = el.getClientRects()[0];
    const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
    const top = document.elementFromPoint(x, y);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) return { error: `"${what}" can't be clicked: something else covers it` };
    return { x, y };
  }
  if (el.tagName === 'SELECT') {
    const option = [...el.options].find((o) => norm(o.text) === norm(text) || o.value === text);
    if (!option) return { error: `"${what}" has no choice "${text}"` };
    el.value = option.value;
    for (const type of ['input', 'change']) el.dispatchEvent(new Event(type, { bubbles: true }));
    return { done: true, typed: true };
  }
  // Whatever the box holds is selected, so the typed text replaces it.
  el.focus();
  if (el.select) el.select();
  else document.getSelection().selectAllChildren(el);
  return { done: true };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Does one step with a real mouse click, real typing or a real key press, then gives the page
// a moment. A key goes to whatever has focus, such as the box just typed in.
async function runStep(page, step) {
  if (step.do === 'press') {
    const { text, keyCode, ...key } = keyFor(step.what);
    const both = { ...key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await page.send('Input.dispatchKeyEvent', { ...both, type: text ? 'keyDown' : 'rawKeyDown', text });
    await page.send('Input.dispatchKeyEvent', { ...both, type: 'keyUp' });
    return settle(page, step);
  }
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
    expression: `(${locate})(${JSON.stringify({ kind: step.do, what: step.what, text: step.text })})`,
    returnByValue: true,
  });
  const found = result?.value;
  if (exceptionDetails || !found) throw new Error(`could not look for "${step.what}" on the page`);
  if (found.error) throw new Error(found.error);
  if (step.do === 'click') {
    const at = { x: found.x, y: found.y, button: 'left', clickCount: 1 };
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: found.x, y: found.y });
    await page.send('Input.dispatchMouseEvent', { ...at, type: 'mousePressed' });
    await page.send('Input.dispatchMouseEvent', { ...at, type: 'mouseReleased' });
  } else if (!found.typed) {
    await page.send('Input.insertText', { text: step.text });
  }
  return settle(page, step);
}

async function settle(page, step) {
  await sleep(SETTLE_MS);
  // A click may have opened another page: wait until whichever page is showing has loaded.
  for (let tries = 0; tries < 50; tries++) {
    const state = await page.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }).catch(() => null);
    if (state?.result?.value === 'complete') return;
    await sleep(100);
  }
  throw new Error(`the page did not finish loading after "${step.what}"`);
}

// Writes <view>-<theme>.png for every view and theme into `dir`, and returns the paths.
// Each theme is set both ways a page might follow it: the system's light or dark setting,
// and the choice a pm page stores under "pm-theme". `steps`, from parseShotArgs, run on the
// loaded page before each picture; a { do: 'full' } step takes the whole height of the page.
export async function takeShots(url, dir = mkdtempSync(join(tmpdir(), 'pm-shots-')), steps = [], bin = findBrowser()) {
  if (!bin) throw new Error(NO_BROWSER);
  const full = steps.some((s) => s.do === 'full');
  steps = steps.filter((s) => s.do !== 'full');
  const cut = [];
  mkdirSync(dir, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'pm-shots-profile-'));
  let child;
  try {
    let address;
    ({ child, address } = await startBrowser(bin, url, profile));
    const page = await connect(address);
    await page.send('Page.enable');
    const files = [];
    for (const view of VIEWS) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: view.width, height: view.height, deviceScaleFactor: 1, mobile: view.mobile });
      for (const theme of THEMES) {
        await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('pm-theme', '${theme}'); } catch (e) {}` });
        // Start each shot from a blank page: going to the same address again with only a
        // "#tab" part would not reload it, so the theme would not change.
        await open(page, 'about:blank');
        await open(page, url);
        await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
        for (const step of steps) await runStep(page, step);
        const file = join(dir, `${view.name}-${theme}.png`);
        const shot = { format: 'png' };
        if (full) {
          // Back to the top (a click may have scrolled), then the whole page from there down.
          const { result } = await page.send('Runtime.evaluate', {
            expression: 'scrollTo(0, 0), Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)',
            returnByValue: true,
          });
          const height = Math.max(result.value, view.height);
          if (height > FULL_MAX) cut.push(`${basename(file)} (${height}px)`);
          Object.assign(shot, { captureBeyondViewport: true, clip: { x: 0, y: 0, width: view.width, height: Math.min(height, FULL_MAX), scale: 1 } });
        }
        const { data } = await page.send('Page.captureScreenshot', shot);
        writeFileSync(file, Buffer.from(data, 'base64'));
        files.push(file);
      }
    }
    page.close();
    if (cut.length) process.stderr.write(`soloagile: the page is taller than ${FULL_MAX}px, so these stop there: ${cut.join(', ')}\n`);
    return files;
  } finally {
    if (child) await stop(child);
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}

// One picture of a mock-up, for `soloagile design`: the whole of its content at `width`, in the
// dark theme the pages open in, and at twice the size so it stays sharp when shown.
const TALLEST = 4000;
export async function takePicture(url, file, width = 360, bin = findBrowser()) {
  if (!bin) throw new Error(NO_BROWSER);
  const profile = mkdtempSync(join(tmpdir(), 'pm-shots-profile-'));
  let child;
  try {
    let address;
    ({ child, address } = await startBrowser(bin, url, profile));
    const page = await connect(address);
    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 200, deviceScaleFactor: 2, mobile: false });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await open(page, url);
    const { result } = await page.send('Runtime.evaluate', { expression: 'Math.ceil(document.documentElement.getBoundingClientRect().height)', returnByValue: true });
    const height = Math.min(Math.max(result.value, 1), TALLEST);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
    writeFileSync(file, Buffer.from(data, 'base64'));
    page.close();
    return file;
  } finally {
    if (child) await stop(child);
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}

// Opens `url` in the browser and hands the page to `fn`, with open(url) to go elsewhere.
// For checks that need a live page, such as watching it refresh itself.
export async function withPage(url, fn, bin = findBrowser()) {
  if (!bin) throw new Error(NO_BROWSER);
  const profile = mkdtempSync(join(tmpdir(), 'pm-shots-profile-'));
  let child;
  try {
    let address;
    ({ child, address } = await startBrowser(bin, url, profile));
    const page = await connect(address);
    await page.send('Page.enable');
    await open(page, url);
    const result = await fn(page);
    page.close();
    return result;
  } finally {
    if (child) await stop(child);
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}
