// `soloagile init`: gives a project its pm/ folder from starter/pm/, keeps the page out of
// git and all of pm/ out of Docker images, then builds the page. Never overwrites.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProject } from './build.js';
import { pageUrl, serverUrls } from './settings.js';

const STARTER = join(dirname(fileURLToPath(import.meta.url)), '..', 'starter', 'pm');

export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Adds `line` to a list file such as .gitignore, unless it is already there.
export function ensureLine(file, line) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (text.split('\n').some((l) => l.trim() === line)) return false;
  writeFileSync(file, text + (text && !text.endsWith('\n') ? '\n' : '') + line + '\n');
  return true;
}

// Fills the starter placeholders. "This page" lists a page server's addresses. With no
// server the page is a file, whose path differs on every machine, so those links are
// dropped rather than committed.
function fill(text, name, date, [url, url2]) {
  text = text.replaceAll('{{name}}', name).replaceAll('{{date}}', date);
  const drop = [!url && /\{\{page\}\}|^## This page$/, !url2 && /\{\{page2\}\}/].filter(Boolean);
  text = text.split('\n').filter((l) => !drop.some((d) => d.test(l))).join('\n').trimEnd() + '\n';
  return text.replaceAll('{{page}}', url).replaceAll('{{page2}}', url2);
}

export function initProject(repoPath, today = localDate()) {
  const repo = resolve(repoPath);
  const dir = join(repo, 'pm');
  const created = [];
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(STARTER)) {
    if (existsSync(join(dir, f))) continue;
    writeFileSync(join(dir, f), fill(readFileSync(join(STARTER, f), 'utf8'), basename(repo), today, serverUrls(repo)));
    created.push(`pm/${f}`);
  }
  if (ensureLine(join(repo, '.gitignore'), 'pm/index.html')) created.push('.gitignore: pm/index.html');
  if (ensureLine(join(repo, '.dockerignore'), 'pm/')) created.push('.dockerignore: pm/');
  const { out, problems } = buildProject(repo);
  return { created, url: pageUrl(repo), out, problems };
}
