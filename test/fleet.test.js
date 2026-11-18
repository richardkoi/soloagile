import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';
import { parseCardLine } from '../src/board.js';
import { runCard } from '../src/card.js';
import { HABITS, habitStates } from '../src/habits.js';
import { fleetBranch, preflight, runDir, unlock } from '../src/fleet.js';

const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'soloagile');
const BOARD = `# Board
<!-- next-id: 3 -->

## Ideas

## Up next
- #1 Parse the feed · M1 · 3 pts · fleet
  done when: the feed parses
- #2 No done when yet · M1 · 2 pts

## Doing

## Needs your look

## Needs your decision

## Done
`;
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-'));
  mkdirSync(join(dir, 'pm'));
  writeFileSync(join(dir, 'pm', 'board.md'), BOARD);
  writeFileSync(join(dir, 'app.js'), '1\n');
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'app.js');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'start');
  return dir;
};

test('a card line carries its fleet or look mark, and card set changes it', () => {
  assert.equal(parseCardLine('#1 Parse · M1 · 3 pts · fleet').mark, 'fleet');
  assert.equal(parseCardLine('#4 Colours · M1 · 1 pt · look · develop').mark, 'look');
  assert.equal(parseCardLine('#5 Plain · M1 · 1 pt').mark, null);
  const plan = '# Plan\n\n## M1 · First · not started\nshort: first\nCards: #1, #2\n';
  const marked = runCard(['set', '2', '--mark', 'look'], { board: BOARD, plan, archive: '', today: '2026-11-18' });
  assert.match(marked.board, /- #2 No done when yet · M1 · 2 pts · look\n/);
  const moved = runCard(['move', '1', 'doing'], { board: BOARD, plan, archive: '', today: '2026-11-18' });
  assert.match(moved.board, /- #1 Parse the feed · M1 · 3 pts · fleet · develop\n/, 'the mark stays through a move');
  const off = runCard(['set', '1', '--mark', 'none'], { board: BOARD, plan, archive: '', today: '2026-11-18' });
  assert.match(off.board, /- #1 Parse the feed · M1 · 3 pts\n/);
  assert.throws(() => runCard(['set', '1', '--mark', 'big'], { board: BOARD, plan, archive: '', today: '2026-11-18' }), /fleet, look or none/);
});

test('the fleet habit starts off and tells Claude to mark cards when it is on', () => {
  const fleet = habitStates(null, { settings: {} }).find((h) => h.key === 'fleet');
  assert.equal(fleet.on, false);
  assert.match(HABITS.find((h) => h.key === 'fleet').rule, /mark logic, data and risky cards fleet and pure visual cards look/);
  assert.equal(habitStates(null, { settings: { habits: { fleet: true } } }).find((h) => h.key === 'fleet').on, true);
});

test('preflight refuses a card with no done when, and a dirty tree', () => {
  const dir = repo();
  assert.throws(() => preflight(dir, 2), /#2 has no done when/);
  writeFileSync(join(dir, 'app.js'), '2\n');
  assert.throws(() => preflight(dir, 1), /uncommitted changes/);
});

test('preflight locks a card, refuses a second run, and clears a lock whose run crashed', () => {
  const dir = repo();
  const first = preflight(dir, 1, { pid: 111, isAlive: () => true });
  assert.equal(first.stage, 'plan');
  assert.equal(JSON.parse(readFileSync(join(runDir(dir, 1), 'lock'), 'utf8')).pid, 111);
  assert.throws(() => preflight(dir, 1, { pid: 222, isAlive: () => true }), /already running \(pid 111/);
  const again = preflight(dir, 1, { pid: 222, isAlive: () => false });
  assert.equal(again.cleared.pid, 111);
  assert.equal(JSON.parse(readFileSync(join(runDir(dir, 1), 'lock'), 'utf8')).pid, 222);
  assert.equal(unlock(dir, 1), true);
  assert.equal(existsSync(join(runDir(dir, 1), 'lock')), false);
});

test('a run resumes at its first missing stage file', () => {
  const dir = repo();
  mkdirSync(runDir(dir, 1), { recursive: true });
  writeFileSync(join(runDir(dir, 1), 'plan.md'), 'plan\n');
  writeFileSync(join(runDir(dir, 1), 'build.md'), 'build\n');
  assert.equal(preflight(dir, 1, { pid: 1, isAlive: () => false }).stage, 'review');
});

test('soloagile fleet preflight and unlock run from the command line', () => {
  const dir = repo();
  const run = (...a) => spawnSync('node', [PM, 'fleet', ...a], { cwd: dir, encoding: 'utf8' });
  const pre = run('preflight', '1');
  assert.equal(pre.status, 0, pre.stderr);
  assert.match(pre.stdout, /#1 is locked for its fleet run\nsoloagile: start at plan/);
  assert.match(run('preflight', '2').stderr, /no done when/);
  assert.match(run('unlock', '1').stdout, /#1 is unlocked/);
  assert.equal(run('nonsense').status, 2);
});

test("fleet branch makes Tobin's copy on card-<n>, kept out of the main tree's status", () => {
  const dir = repo();
  const first = fleetBranch(dir, 1);
  assert.equal(first.made, true);
  assert.equal(first.branch, 'card-1');
  assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: first.path, encoding: 'utf8' }).trim(), 'card-1');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).replace(/.. pm\/\n?/g, ''), '', 'the copy leaves the main tree clean');
  assert.equal(fleetBranch(dir, 1).made, false, 'a second call finds it');
  assert.doesNotThrow(() => preflight(dir, 1, { pid: 1, isAlive: () => false }));
});

test('Tobin is a plugin agent with set tools, a turn cap and the strongest model; Orla is the fleet skill', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const tobin = readFileSync(join(root, 'agents', 'tobin.md'), 'utf8');
  assert.match(tobin, /^name: tobin$/m);
  assert.match(tobin, /^model: opus$/m);
  assert.match(tobin, /^tools: Read, Edit, Write, Bash, Glob, Grep$/m);
  assert.match(tobin, /^maxTurns: \d+$/m);
  const skill = readFileSync(join(root, 'skills', 'fleet', 'SKILL.md'), 'utf8');
  assert.match(skill, /subagent_type: "soloagile:tobin"/);
  assert.match(skill, /soloagile fleet preflight <n>/);
  assert.match(skill, /don't restart or message him for more turns/);
});
