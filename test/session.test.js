import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import './isolate.js';
import { commitHandoff, sessionStartOutput, startSummary } from '../src/session.js';

const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'soloagile');
const tmp = () => mkdtempSync(join(tmpdir(), 'pm-session-'));
const git = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

const BOARD = `# Board
<!-- next-id: 9 -->
## Ideas
- #1 Someday
## Up next
- #2 Next thing · M1
## Doing
- #3 Current thing · M1
## Needs your look
- #4 Look at this · M1 · built 2026-09-30
- #5 And this · M1 · built 2026-09-30
## Needs your decision
- #6 Which one? · M1 · asked 2026-09-30
  a) This (recommended)
## Done
`;

function pmProject(board = BOARD) {
  const repo = tmp();
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), board);
  writeFileSync(join(repo, 'pm', 'plan.md'), '# Alpha Tool\n### M1 — First · in progress\n');
  return repo;
}

// A repo with one commit, holding a board, a handoff note and some code.
function gitRepo() {
  const repo = pmProject();
  writeFileSync(join(repo, 'NEXT_SESSION.md'), 'note\n');
  writeFileSync(join(repo, 'app.js'), 'one\n');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'start');
  return repo;
}

test('start: what waits on the user for them, and the board for Claude', () => {
  const repo = pmProject();
  const { message, context } = startSummary(repo);
  assert.equal(message, `Alpha Tool · 1 decision and 2 looks waiting on you · say "catch me up" · ${pathToFileURL(join(repo, 'pm', 'index.html')).href}`);
  assert.match(context, /Needs your decision:\n- #6 Which one\?/);
  assert.match(context, /Doing:\n- #3 Current thing/);
  assert.match(context, /Up next:\n- #2 Next thing/);
  assert.doesNotMatch(context, /#1 Someday/, 'ideas stay out');
  assert.match(context, /No finished cards yet, so guess each new card's build time/, 'the build times to guess from');
});

test("start: a look that can't happen yet isn't counted, and Claude is told why", () => {
  const later = BOARD.replace('- #5 And this · M1 · built 2026-09-30', '- #5 And this · M1 · from 2026-10-05');
  const { message, context } = startSummary(pmProject(later), { today: '2026-10-02' });
  assert.match(message, /1 decision and 1 look waiting on you/);
  assert.match(context, /Needs your look:\n- #4 Look at this\n/);
  assert.match(context, /Looks that can't happen yet \(not waiting on the user\):\n- #5 And this, from 2026-10-05/);
});

test('start: the line ends with the page link: a page server\'s address, or else the file', () => {
  const repo = pmProject();
  assert.match(startSummary(repo, { url: 'http://pages.test/alpha/' }).message, /say "catch me up" · http:\/\/pages\.test\/alpha\/$/);
  assert.match(startSummary(repo).message, /say "catch me up" · file:\/\/\/.*\/pm\/index\.html$/, 'a folder no page server serves opens as a file');
});

test('start: a calm board says so', () => {
  const calm = BOARD.replace(/## Needs your look[\s\S]*## Done/, '## Needs your look\n## Needs your decision\n## Done');
  assert.match(startSummary(pmProject(calm)).message, /nothing waiting on you/);
});

test('start: a handoff note without a board still gets a line; a plain folder gets nothing', () => {
  const noted = tmp();
  writeFileSync(join(noted, 'NEXT_SESSION.md'), 'note\n');
  assert.deepEqual(startSummary(noted), { message: `${noted.split('/').pop()} has a handoff note · say "catch me up"`, context: null });
  assert.equal(startSummary(tmp()), null);
  assert.equal(sessionStartOutput({ cwd: tmp() }), null);
});

test('soloagile session-start prints the hook JSON Claude Code expects', () => {
  const r = spawnSync(PM, ['session-start'], { input: JSON.stringify({ cwd: pmProject(), source: 'startup' }), encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.match(out.systemMessage, /^Alpha Tool · /);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /catchup/);
  assert.match(out.hookSpecificOutput.additionalContext, /^# soloagile rules\n/, 'the short rules come first');
  assert.match(out.hookSpecificOutput.additionalContext, /each rule in full: `\/.*\/SPEC\.md`/, 'and say where the full format is, as a real path');
  assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /\{\{/);
});

test('end: commits only the handoff files, leaving other work as it was', () => {
  const repo = gitRepo();
  writeFileSync(join(repo, 'pm', 'board.md'), BOARD + '- #8 Finished · M1 · 2026-09-30\n');
  writeFileSync(join(repo, 'pm', 'releases.md'), '# Release notes\n');
  writeFileSync(join(repo, 'NEXT_SESSION.md'), 'new note\n');
  writeFileSync(join(repo, 'app.js'), 'two\n');
  writeFileSync(join(repo, 'staged.js'), 'staged\n');
  git(repo, 'add', 'staged.js');

  const r = commitHandoff(repo, { push: false });
  assert.deepEqual(r.committed.sort(), ['NEXT_SESSION.md', 'pm/board.md', 'pm/releases.md']);
  assert.equal(git(repo, 'log', '-1', '--format=%s').stdout.trim(), 'Handoff saved at session end (automatic)');
  assert.deepEqual(git(repo, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split('\n').sort(),
    ['NEXT_SESSION.md', 'pm/board.md', 'pm/releases.md']);
  assert.equal(git(repo, 'status', '--porcelain').stdout, ' M app.js\nA  staged.js\n');
});

test('end: nothing changed, not a repo, or a detached HEAD means no commit', () => {
  const repo = gitRepo();
  assert.equal(commitHandoff(repo, { push: false }).reason, 'nothing to save');
  assert.equal(commitHandoff(tmp(), { push: false }).reason, 'not a git repo');
  git(repo, 'checkout', '-q', '--detach');
  writeFileSync(join(repo, 'NEXT_SESSION.md'), 'changed\n');
  assert.equal(commitHandoff(repo, { push: false }).reason, 'detached HEAD');
});

test('soloagile session-end does nothing until its install option is turned on', () => {
  const repo = gitRepo();
  writeFileSync(join(repo, 'NEXT_SESSION.md'), 'a note left dirty\n');
  const end = (option) => {
    const env = { ...process.env, ...(option !== undefined && { CLAUDE_PLUGIN_OPTION_SAVE_AT_SESSION_END: option }) };
    if (option === undefined) delete env.CLAUDE_PLUGIN_OPTION_SAVE_AT_SESSION_END;
    return spawnSync(PM, ['session-end'], { input: JSON.stringify({ cwd: repo, reason: 'prompt_input_exit' }), encoding: 'utf8', env });
  };
  const head = () => git(repo, 'rev-parse', 'HEAD').stdout.trim();
  const before = head();
  assert.equal(end(undefined).status, 0);
  assert.equal(end('false').status, 0);
  assert.equal(head(), before, 'off by default, and when the option says false');
  assert.equal(end('true').status, 0);
  assert.notEqual(head(), before, 'on once the option is true');
});

test('soloagile session-end commits and pushes to the upstream', async () => {
  const remote = tmp();
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  const repo = gitRepo();
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  writeFileSync(join(repo, 'NEXT_SESSION.md'), 'pushed note\n');

  const r = spawnSync(PM, ['session-end'], { input: JSON.stringify({ cwd: repo, reason: 'prompt_input_exit' }), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_OPTION_SAVE_AT_SESSION_END: 'true' } });
  assert.equal(r.status, 0);
  const head = git(repo, 'rev-parse', 'HEAD').stdout.trim();
  // The push runs on in the background after the hook returns.
  for (let i = 0; i < 50 && git(remote, 'rev-parse', 'main').stdout.trim() !== head; i++) await new Promise((ok) => setTimeout(ok, 100));
  assert.equal(git(remote, 'rev-parse', 'main').stdout.trim(), head);
});

test('start: a busy board still fits under Claude Code\'s 10,000-character limit, rules whole (#177)', () => {
  const long = (n) => `- #${n} A card with a long title that goes on about the far overcast sheet near the horizon, left by #${n - 1} · M1 · 3 pts`;
  const busy = BOARD.replace('- #2 Next thing · M1', Array.from({ length: 40 }, (_, i) => long(100 + i)).join('\n'))
    .replace('- #4 Look at this · M1 · built 2026-09-30', Array.from({ length: 6 }, (_, i) => long(200 + i).replace('3 pts', 'live 2026-09-30')).join('\n'));
  const { context } = startSummary(pmProject(busy));
  assert.ok(context.length < 10000, `start text is ${context.length} characters`);
  assert.match(context, /The format of every file, and each rule in full/, 'the rules arrive whole');
  assert.match(context, /- #205 A card/, 'every look stays');
  assert.match(context, /- #100 A card/, 'Up next starts at its top');
  assert.match(context, /…and \d+ more in Up next: soloagile board/, 'says what was left out');
  assert.match(context, /run the soloagile:catchup skill/, 'the last line stays');
});
