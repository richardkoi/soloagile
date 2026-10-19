// The Claude Code PostToolUse hook behind `soloagile hook`: after any tool call, rebuild
// the page of each project whose pm/*.md files are newer than its pm/index.html,
// then the home page if any of them is one it lists.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { buildProject } from './build.js';
import { buildHome } from './home.js';
import { onHome, projectsFolderOf } from './settings.js';

// Only folders holding our board or plan count, so an unrelated pm/ is left alone.
export function isPmProject(repo) {
  return existsSync(join(repo, 'pm', 'board.md')) || existsSync(join(repo, 'pm', 'plan.md'));
}

// The projects a tool call may have touched: the edited file's project when it is
// a pm/*.md, plus the session's folder, because a Bash edit names no file.
export function projectsFor(payload) {
  const found = new Set();
  const file = payload?.tool_input?.file_path;
  if (typeof file === 'string' && extname(file) === '.md' && basename(dirname(file)) === 'pm') {
    found.add(dirname(dirname(resolve(file))));
  }
  if (typeof payload?.cwd === 'string') found.add(resolve(payload.cwd));
  return [...found].filter(isPmProject);
}

// Out of date when the page is missing or any pm/*.md changed after it was built.
export function isStale(repo) {
  const dir = join(repo, 'pm');
  const page = join(dir, 'index.html');
  if (!existsSync(page)) return true;
  const builtAt = statSync(page).mtimeMs;
  return readdirSync(dir).some((f) => f.endsWith('.md') && statSync(join(dir, f)).mtimeMs > builtAt);
}

// `home` says where the home page's projects live and where it is written. Without it,
// each rebuilt project's own projects folder is used (src/settings.js); tests pass temp folders.
export function runHook(payload, home) {
  const built = [];
  const problems = [];
  const roots = new Set();
  for (const repo of projectsFor(payload)) {
    if (!isStale(repo)) continue;
    const r = buildProject(repo);
    built.push(r.out);
    problems.push(...r.problems.map((p) => `${basename(repo)}: ${p}`));
    if (home ? dirname(repo) === resolve(home.root) : onHome(repo)) roots.add(home ? home.root : projectsFolderOf(repo));
  }
  for (const root of roots) buildHome({ ...home, root });
  return { built, problems };
}
