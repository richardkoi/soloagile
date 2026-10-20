// The two session hooks behind `soloagile session-start` and `soloagile session-end`.
// Start: in a project with a board, show the user what waits on them and give Claude the
// board, so "catch me up" has it already. End: commit and push the handoff files
// (pm/*.md, NEXT_SESSION.md, QUESTIONS.md) that a forgotten /soloagile:save left dirty.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLater, parseBoard, parsePlan } from './board.js';
import { buildProject } from './build.js';
import { buildHome } from './home.js';
import { isPmProject } from './hook.js';
import { localDate } from './init.js';
import { onHome, pageUrl, projectsFolderOf } from './settings.js';
import { readSizes } from './sizes.js';
import { habitStates, habitsText } from './habits.js';
import { VERSION, builtBy, compareVersions } from './version.js';

// The short rules, which the start hook gives Claude in a project with a board. A plugin's
// own CLAUDE.md is never loaded, so this is how they arrive. They end with where the full
// format is: SPEC.md, in the plugin's folder.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const rules = () => readFileSync(join(ROOT, 'rules.md'), 'utf8').replace('{{spec}}', join(ROOT, 'SPEC.md')).trim();

const cardsIn = (board, column) => board.columns.find((c) => c.name === column)?.cards ?? [];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const line = (c) => `#${c.id} ${c.title}`;

// What the start hook says: `message` for the user's screen, ending with the page's link
// so they can open it, and `context` for Claude. `url` and `today` are only overridden by the tests.
export function startSummary(repo, { url = pageUrl(repo), today = localDate() } = {}) {
  repo = resolve(repo);
  if (!isPmProject(repo)) {
    return existsSync(join(repo, 'NEXT_SESSION.md'))
      ? { message: `${basename(repo)} has a handoff note · say "catch me up"`, context: null }
      : null;
  }
  const read = (f) => (existsSync(join(repo, 'pm', f)) ? readFileSync(join(repo, 'pm', f), 'utf8') : '');
  const board = parseBoard(read('board.md'));
  const name = parsePlan(read('plan.md')).title ?? basename(repo);
  const decide = cardsIn(board, 'Needs your decision');
  const looks = cardsIn(board, 'Needs your look');
  const later = looks.filter((c) => isLater(c, 'Needs your look', today));
  const look = looks.filter((c) => !later.includes(c));
  const waiting = [decide.length && plural(decide.length, 'decision'), look.length && plural(look.length, 'look')].filter(Boolean);
  const message = `${name} · ${waiting.length ? `${waiting.join(' and ')} waiting on you` : 'nothing waiting on you'} · say "catch me up"${url ? ` · ${url}` : ''}`;

  const section = (title, cards) => (cards.length ? [`${title}:`, ...cards.map((c) => `- ${line(c)}`)] : []);
  const context = [
    rules(),
    '',
    `Board for ${name} (pm/board.md), read when this session started:`,
    ...section('Needs your decision', decide),
    ...section('Needs your look', look),
    ...(later.length ? ["Looks that can't happen yet (not waiting on the user):", ...later.map((c) => `- ${line(c)}, from ${c.date.value}`)] : []),
    ...section('Doing', cardsIn(board, 'Doing')),
    ...section('Up next', cardsIn(board, 'Up next')),
    '',
    readSizes(repo),
    '',
    ...(habitsText(habitStates(repo)) ? [habitsText(habitStates(repo)), ''] : []),
    'When the user greets you or asks where things stand ("catch me up", "what\'s next"), run the soloagile:catchup skill.',
  ].join('\n');
  return { message, context };
}

// A page built by an older soloagile is rebuilt when a session starts in its project, so
// an update shows on the page without waiting for a card to move. Returns whether it built.
export function refreshOldPage(repo) {
  repo = resolve(repo);
  if (!isPmProject(repo)) return false;
  const by = builtBy(join(repo, 'pm', 'index.html'));
  if (by && compareVersions(by, VERSION) >= 0) return false;
  buildProject(repo);
  if (onHome(repo)) buildHome({ root: projectsFolderOf(repo) });
  return true;
}

// The JSON a SessionStart hook prints, or null to print nothing.
export function sessionStartOutput(payload) {
  if (typeof payload?.cwd === 'string') {
    try {
      refreshOldPage(payload.cwd);
    } catch {}
  }
  const summary = typeof payload?.cwd === 'string' ? startSummary(payload.cwd) : null;
  if (!summary) return null;
  return {
    systemMessage: summary.message,
    ...(summary.context && { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: summary.context } }),
  };
}

const git = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
const HANDOFF = /^(NEXT_SESSION\.md|QUESTIONS\.md|pm\/[^/]+\.md)$/;

// Saving at session end is off until the user chooses it: an option asked when the plugin
// is installed, which Claude Code hands to the hook as CLAUDE_PLUGIN_OPTION_SAVE_AT_SESSION_END.
export const savesAtEnd = (env = process.env) => /^(true|1|yes)$/i.test(env.CLAUDE_PLUGIN_OPTION_SAVE_AT_SESSION_END ?? '');

// Commits the handoff files that changed, and nothing else, then pushes in the
// background. `push: false` lets the tests skip the push. Returns what it did.
export function commitHandoff(dir, { push = true } = {}) {
  const top = git(dir, 'rev-parse', '--show-toplevel');
  if (top.status !== 0) return { committed: [], reason: 'not a git repo' };
  const repo = top.stdout.trim();
  const gitDir = resolve(repo, git(repo, 'rev-parse', '--git-dir').stdout.trim());
  // Mid-merge or mid-rebase, a commit would land in the middle of it.
  if (['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD'].some((f) => existsSync(join(gitDir, f)))) {
    return { committed: [], reason: 'a merge or rebase is in progress' };
  }
  if (git(repo, 'symbolic-ref', '-q', 'HEAD').status !== 0) return { committed: [], reason: 'detached HEAD' };

  // -z keeps odd file names intact; --untracked-files=all lists a new pm/ file by file.
  const status = git(repo, 'status', '--porcelain', '-z', '--untracked-files=all', '--', 'NEXT_SESSION.md', 'QUESTIONS.md', 'pm');
  const files = status.stdout.split('\0').filter(Boolean).map((e) => e.slice(3)).filter((f) => HANDOFF.test(f));
  if (!files.length) return { committed: [], reason: 'nothing to save' };

  if (git(repo, 'add', '-A', '--', ...files).status !== 0) return { committed: [], reason: 'git add failed' };
  // Naming the files commits only them, even if other work is staged.
  const commit = git(repo, 'commit', '-q', '-m', 'Handoff saved at session end (automatic)', '--', ...files);
  if (commit.status !== 0) return { committed: [], reason: `git commit failed: ${commit.stderr.trim()}` };

  const upstream = git(repo, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}').status === 0;
  if (push && upstream) {
    // Claude Code gives exit hooks about 1.5 seconds, so the push runs on after we return.
    spawn('git', ['-C', repo, 'push', '-q'], { detached: true, stdio: 'ignore' }).unref();
  }
  return { committed: files, pushed: push && upstream };
}
