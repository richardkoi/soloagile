// soloagile cleanup: clears what can be made again and is no longer needed (#146).
//   - helper worktrees under .claude/worktrees whose branch is merged and nothing is left uncommitted
//   - soloagile shots folders (pm-shots-*) in the temp folder, untouched for a week
//   - card picture pages (pm/designs/card-<n>/) of cards finished over a week ago; their
//     kept script in pm/takes/ stays, so `soloagile retake` brings one back
// A session start runs it once a week when the weekly-cleanup habit is on.
// soloagile backup runs the command named "backup" in pm/settings.json, for "done for today".
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { parseCardLine } from './board.js';
import { readArchive } from './archive.js';
import { ownDir } from './settings.js';

const DAY = 24 * 60 * 60 * 1000;
const git = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

// Card number -> the day it finished, from pm/finished-cards.md.
function finishedOn(archiveMd) {
  const days = new Map();
  for (const line of archiveMd.split('\n')) {
    if (!/^- #\d+ /.test(line)) continue;
    const c = parseCardLine(line.slice(2));
    if (c.date?.value) days.set(c.id, c.date.value);
  }
  return days;
}

function mergedWorktrees(repo) {
  const list = git(repo, 'worktree', 'list', '--porcelain');
  if (list.status !== 0) return [];
  const found = [];
  for (const block of list.stdout.split('\n\n')) {
    const path = block.match(/^worktree (.+)$/m)?.[1];
    const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1];
    if (!path || !branch || !path.includes(`${sep}.claude${sep}worktrees${sep}`)) continue;
    const clean = git(path, 'status', '--porcelain').stdout.trim() === '';
    const merged = git(repo, 'merge-base', '--is-ancestor', branch, 'HEAD').status === 0;
    // A helper that has only just started sits on one of main's own commits, which also counts
    // as "merged". Finished work came in by a merge, so its tip is off main's first-parent line.
    const tip = git(repo, 'rev-parse', branch).stdout.trim();
    const onMainLine = git(repo, 'rev-list', '--first-parent', 'HEAD').stdout.split('\n').includes(tip);
    if (clean && merged && !onMainLine) found.push(path);
  }
  return found;
}

// What it removed (or would, with dry), as lines to print.
export function cleanupProject(repo, { days = 7, now = new Date(), dry = false, temp = tmpdir() } = {}) {
  repo = resolve(repo);
  const said = [];
  const old = (path) => now - statSync(path).mtimeMs > days * DAY;
  const gone = (path, what) => {
    if (!dry) rmSync(path, { recursive: true, force: true });
    said.push(`${dry ? 'would remove' : 'removed'} ${what}: ${path}`);
  };

  for (const path of mergedWorktrees(repo)) {
    if (!dry) git(repo, 'worktree', 'remove', path);
    said.push(`${dry ? 'would remove' : 'removed'} a merged helper worktree: ${path}`);
  }
  if (existsSync(temp)) {
    for (const f of readdirSync(temp)) {
      if (f.startsWith('pm-shots-') && old(join(temp, f))) gone(join(temp, f), 'an old shots folder');
    }
  }
  const designs = join(repo, 'pm', 'designs');
  if (existsSync(designs)) {
    const finished = finishedOn(readArchive(repo));
    const cutoff = new Date(now - days * DAY).toISOString().slice(0, 10);
    for (const f of readdirSync(designs)) {
      const id = Number(f.match(/^card-(\d+)$/)?.[1]);
      const day = finished.get(id);
      if (day && day < cutoff) gone(join(designs, f), `#${id}'s picture page, finished ${day}`);
    }
  }
  return said;
}

// Once a week per project: the stamps live in ~/.soloagile/cleanups.json.
export function weeklyCleanup(repo, { now = new Date(), days = 7 } = {}) {
  const file = join(ownDir(), 'cleanups.json');
  let stamps = {};
  try {
    stamps = JSON.parse(readFileSync(file, 'utf8'));
  } catch {}
  const key = resolve(repo);
  if (stamps[key] && now - new Date(stamps[key]) < days * DAY) return null;
  const said = cleanupProject(repo, { now, days });
  stamps[key] = now.toISOString();
  try {
    writeFileSync(file, `${JSON.stringify(stamps, null, 2)}\n`);
  } catch {}
  return said;
}

// The project's backup command, from "backup" in pm/settings.json, or null.
export function backupCommand(repo) {
  try {
    return JSON.parse(readFileSync(join(resolve(repo), 'pm', 'settings.json'), 'utf8')).backup ?? null;
  } catch {
    return null;
  }
}
