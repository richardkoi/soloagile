// Where things are, worked out so that nothing is asked at install.
// With no settings, a project's page is its own file on disk, and its home page lists the
// projects in the folder it sits in. Someone who runs a page server says so once, in
// ~/.soloagile/settings.json. Every key is optional:
//   pageUrl         the server's address for a project's page, with {project} for its folder name
//   pageUrl2        a second address for the same page, such as one that works away from home
//   projectsFolder  the folder the server serves; only projects directly in it get those addresses
//   homePage        where the home page is written
// ~/.soloagile also holds the home page, and a stamp for each page (see stampOf).
// SOLOAGILE_DIR moves the folder; the tests use it.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ownDir = () => process.env.SOLOAGILE_DIR || join(homedir(), '.soloagile');

// Read on every call, so an edit takes effect at the next build.
export function readSettings() {
  const file = join(ownDir(), 'settings.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
}

// The folder whose projects share a home page: the one set, or the one this project sits in.
export function projectsFolderOf(repo, settings = readSettings()) {
  return settings.projectsFolder ? resolve(settings.projectsFolder) : dirname(resolve(repo));
}

// Is this project one of the projects folder's own? Always, unless a folder is set.
export const onHome = (repo, settings = readSettings()) => dirname(resolve(repo)) === projectsFolderOf(repo, settings);

const fill = (pattern, repo) => pattern.replaceAll('{project}', basename(resolve(repo)));

// The page server's addresses for a project's page: [first, second], each null when not set.
export function serverUrls(repo, settings = readSettings()) {
  const served = settings.pageUrl && onHome(repo, settings);
  return [served ? fill(settings.pageUrl, repo) : null, served && settings.pageUrl2 ? fill(settings.pageUrl2, repo) : null];
}

// Where to open a project's page: the server's address, or else the file itself.
export function pageUrl(repo, settings = readSettings()) {
  return serverUrls(repo, settings)[0] ?? pathToFileURL(join(resolve(repo), 'pm', 'index.html')).href;
}

// A home page's link to one of its projects. On a server it is the path alone, so the
// link works at every address the server answers on.
export function homeLink(repo, settings = readSettings()) {
  return settings.pageUrl ? new URL(fill(settings.pageUrl, repo)).pathname : pathToFileURL(join(resolve(repo), 'pm', 'index.html')).href;
}

export const homePage = (settings = readSettings()) => (settings.homePage ? resolve(settings.homePage) : join(ownDir(), 'home.html'));

// A page opened as a file can't ask a server whether it changed, so each build leaves a
// stamp: a one-line script saying when the page was built. The open page loads it every
// few seconds and reloads itself when the time is not its own (template/refresh.html).
// The stamp lives in ~/.soloagile/stamps, named after the page's path, so nothing new
// appears in the project for git to see.
export function stampOf(page) {
  const file = join(ownDir(), 'stamps', `${createHash('sha1').update(resolve(page)).digest('hex').slice(0, 16)}.js`);
  return { file, url: pathToFileURL(file).href };
}

// Never stops a build: a page without a stamp only loses its refresh.
export function writeStamp(page, builtAt) {
  try {
    const { file } = stampOf(page);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `window.__soloagileBuilt && window.__soloagileBuilt(${JSON.stringify(builtAt.toISOString())});\n`);
  } catch {}
}
