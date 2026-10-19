import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import './isolate.js';
import { homeLink, homePage, onHome, pageUrl, projectsFolderOf, readSettings, serverUrls } from '../src/settings.js';

const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'soloagile');
const temp = () => mkdtempSync(join(tmpdir(), 'soloagile-set-'));
const fileOf = (repo) => pathToFileURL(join(repo, 'pm', 'index.html')).href;

test('with no settings, nothing is asked: the page is its own file, and its folder is the projects folder', () => {
  const none = {};
  assert.equal(pageUrl('/code/alpha', none), 'file:///code/alpha/pm/index.html');
  assert.deepEqual(serverUrls('/code/alpha', none), [null, null]);
  assert.equal(projectsFolderOf('/code/alpha', none), '/code');
  assert.equal(onHome('/code/alpha', none), true);
  assert.equal(homeLink('/code/alpha', none), 'file:///code/alpha/pm/index.html');
  assert.equal(homePage(none), join(process.env.SOLOAGILE_DIR, 'home.html'));
});

test('a page server is set once: its addresses, for the projects in its folder', () => {
  const set = { pageUrl: 'http://10.0.0.5/{project}/', pageUrl2: 'http://desk/{project}/', projectsFolder: '/srv/projects', homePage: '/srv/home/index.html' };
  assert.equal(pageUrl('/srv/projects/alpha', set), 'http://10.0.0.5/alpha/');
  assert.deepEqual(serverUrls('/srv/projects/alpha', set), ['http://10.0.0.5/alpha/', 'http://desk/alpha/']);
  assert.equal(homeLink('/srv/projects/alpha', set), '/alpha/', 'the path alone, so it works at both addresses');
  assert.equal(homePage(set), '/srv/home/index.html');
  assert.equal(onHome('/elsewhere/beta', set), false);
  assert.equal(pageUrl('/elsewhere/beta', set), 'file:///elsewhere/beta/pm/index.html', 'a project the server does not serve opens as a file');
  assert.deepEqual(serverUrls('/srv/projects/alpha', { pageUrl: set.pageUrl }), ['http://10.0.0.5/alpha/', null]);
});

test('settings.json is read from the folder SOLOAGILE_DIR names, and a broken one says where it is', () => {
  const mine = process.env.SOLOAGILE_DIR;
  try {
    process.env.SOLOAGILE_DIR = temp();
    assert.deepEqual(readSettings(), {}, 'no file means no settings');
    writeFileSync(join(process.env.SOLOAGILE_DIR, 'settings.json'), '{ not json');
    assert.throws(readSettings, /settings\.json is not valid JSON/);
  } finally {
    process.env.SOLOAGILE_DIR = mine;
  }
});

test('soloagile build with no settings: the home page lists the folder\'s projects, linked as files', () => {
  const own = temp();
  const folder = temp();
  for (const name of ['alpha', 'beta']) {
    mkdirSync(join(folder, name, 'pm'), { recursive: true });
    writeFileSync(join(folder, name, 'pm', 'board.md'), '# Board\n<!-- next-id: 1 -->\n## Ideas\n## Up next\n## Doing\n## Needs your look\n## Needs your decision\n## Done\n');
  }
  const pm = (...args) => spawnSync(PM, args, { encoding: 'utf8', env: { ...process.env, SOLOAGILE_DIR: own } });
  assert.equal(pm('build', join(folder, 'alpha')).status, 0);
  const r = pm('build', join(folder, 'beta'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`soloagile: wrote ${join(own, 'home.html')}`));
  const home = readFileSync(join(own, 'home.html'), 'utf8');
  for (const name of ['alpha', 'beta']) assert.ok(home.includes(`href="${fileOf(join(folder, name))}"`), `${name} is linked by its file`);
  assert.ok(!existsSync(join(folder, 'home')), 'nothing is written into the projects folder itself');
  assert.equal(pm('link', join(folder, 'alpha')).stdout.trim(), fileOf(join(folder, 'alpha')), 'soloagile link prints where the page opens');
});
