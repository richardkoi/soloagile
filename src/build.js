import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readArchive } from './archive.js';
import { readPictures } from './design.js';
import { readCardPages } from './pictures.js';
import { habitStates } from './habits.js';
import { recordMoves } from './history.js';
import { renderPage } from './page.js';
import { stampOf, writeStamp } from './settings.js';

export const FILES = ['board', 'plan', 'releases', 'overview', 'decisions', 'links'];
// A page over this many bytes is slow to open, on a phone above all, so the build warns (#128).
export const PAGE_WARN_MB = 5;
const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'template');

// Reads template/<file> with each "{{> part}}" replaced by template/part.html, so the
// project page and the home page share one copy of the styles and scripts.
export function readTemplate(file) {
  return readFileSync(join(TEMPLATES, file), 'utf8').replace(/\{\{> (\w+)\}\}/g, (_, part) =>
    readFileSync(join(TEMPLATES, `${part}.html`), 'utf8').replace(/\n$/, ''),
  );
}

// Reads <repo>/pm/*.md; a missing file reads as '' so a half-set-up project still builds.
export function readProject(repoPath) {
  const repo = resolve(repoPath);
  const dir = join(repo, 'pm');
  if (!existsSync(dir)) throw new Error(`no pm/ folder in ${repo}`);
  const md = {};
  for (const f of FILES) {
    const p = join(dir, `${f}.md`);
    md[f] = existsSync(p) ? readFileSync(p, 'utf8') : '';
  }
  return { repo, dir, name: basename(repo), md };
}

// A card's own picture page (soloagile pictures), keyed "card-<n>" beside the option pictures.
const cardPages = (dir) => Object.fromEntries(Object.entries(readCardPages(dir)).map(([id, count]) => [`card-${id}`, { count }]));

export function buildProject(repoPath, builtAt = new Date()) {
  const { repo, dir, name, md } = readProject(repoPath);
  const template = readTemplate('page.html');
  // The log is brought up to date first, because the Reports tab reads it. It is also
  // written before the page, so the page stays newer than every pm/*.md and the hook
  // doesn't see it as out of date. A log that can't be written never stops the page.
  const problems = [];
  try {
    if (md.board) recordMoves(repo, md.board, builtAt);
  } catch (err) {
    problems.push(`history.md: not written (${err.message})`);
  }
  const history = join(dir, 'history.md');
  md.history = existsSync(history) ? readFileSync(history, 'utf8') : '';
  md.finished = readArchive(repo);
  const out = join(dir, 'index.html');
  const page = renderPage({ name, md, builtAt, template, pictures: { ...readPictures(dir), ...cardPages(dir) }, stampUrl: stampOf(out).url, habits: habitStates(repo) });
  writeFileSync(out, page.html);
  const mb = Buffer.byteLength(page.html) / 1024 / 1024;
  if (mb > PAGE_WARN_MB) problems.push(`index.html is ${mb.toFixed(1)} MB: a page over ${PAGE_WARN_MB} MB is slow to open; look for what is filling it, such as a long decisions.md`);
  // A file:// address opens only on this machine, never from a phone or another computer (#168).
  for (const line of md.links.split('\n')) {
    const file = line.match(/\]\((file:[^)\s]*)/);
    if (file) problems.push(`links.md: ${file[1]} is a file:// address, which opens only on this machine; serve it and link the http address instead`);
  }
  writeStamp(out, builtAt);
  return { out, problems: [...problems, ...page.problems] };
}
