import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';
import { HABITS, habitStates, habitsText, renderSettings, setHabit } from '../src/habits.js';

const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'soloagile');
const GLOBAL = join(process.env.SOLOAGILE_DIR, 'settings.json');
function project() {
  const repo = mkdtempSync(join(tmpdir(), 'soloagile-habits-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), '# Board\n## Ideas\n## Up next\n## Doing\n## Needs your look\n## Needs your decision\n## Done\n');
  writeFileSync(join(repo, 'pm', 'plan.md'), '# Alpha\n### M1 — First · in progress\nshort: First\n');
  return repo;
}
const TWO = [
  { key: 'away-mode', name: 'Away mode', what: 'Works the board while you are gone.', card: 139, rule: 'When the user says they are away, ask first, then work Up next.' },
  { key: 'batches', name: 'Questions in batches', what: 'Up to four at a time.', card: 148 },
];
const stateOf = (repo, key, habits = TWO) => habitStates(repo, { habits }).find((h) => h.key === key);

test('every habit is on until switched off; this project beats all projects', () => {
  const repo = project();
  assert.deepEqual([stateOf(repo, 'away-mode').on, stateOf(repo, 'away-mode').from], [true, 'default']);
  setHabit(null, 'away-mode', false, TWO);
  assert.deepEqual([stateOf(repo, 'away-mode').on, stateOf(repo, 'away-mode').from], [false, 'all projects']);
  setHabit(repo, 'away-mode', true, TWO);
  assert.deepEqual([stateOf(repo, 'away-mode').on, stateOf(repo, 'away-mode').from], [true, 'this project']);
  assert.deepEqual(JSON.parse(readFileSync(join(repo, 'pm', 'settings.json'), 'utf8')), { habits: { 'away-mode': true } });
  assert.ok(JSON.parse(readFileSync(GLOBAL, 'utf8')).pageUrl, 'the other settings are kept');
  assert.throws(() => setHabit(repo, 'nope', true, TWO), /no habit called "nope"\. The habits: away-mode, batches/);
  setHabit(null, 'away-mode', true, TWO);
});

test('Claude is told only the habits that are built: on ones to follow, off ones to skip', () => {
  const repo = project();
  assert.equal(habitsText(habitStates(repo, { habits: TWO.slice(1) })), '', 'nothing built, nothing said');
  assert.match(habitsText(habitStates(repo, { habits: TWO })), /^Habits, from soloagile's settings:\n- Away mode: on\. When the user says they are away/);
  setHabit(repo, 'away-mode', false, TWO);
  assert.match(habitsText(habitStates(repo, { habits: TWO })), /- Away mode: off\. Don't do it\.$/);
});

test('the Settings tab: each habit, on or off, where that comes from, and the command that flips it', () => {
  const repo = project();
  setHabit(repo, 'away-mode', false, TWO);
  const html = renderSettings(habitStates(repo, { habits: TWO }));
  assert.match(html, /Away mode<\/h3><span class="habit-state off">off<\/span>/);
  assert.match(html, /set for this project/);
  assert.match(html, /<code>soloagile set away-mode on<\/code>/);
  assert.match(html, /Questions in batches.*coming with #148/s);
});

test('soloagile set: flips a habit here, or for every project with --all, and lists them with no habit named', () => {
  const repo = project();
  const run = (...args) => spawnSync(PM, ['set', ...args], { cwd: repo, encoding: 'utf8' });
  const key = HABITS[0].key;
  const off = run(key, 'off');
  assert.equal(off.status, 0, off.stderr);
  assert.match(off.stdout, new RegExp(`${HABITS[0].name} is off for this project`));
  assert.match(readFileSync(join(repo, 'pm', 'index.html'), 'utf8'), new RegExp(`soloagile set ${key} on</code>`), 'the page is rebuilt');
  assert.match(run().stdout, new RegExp(`${key} +off +this project`));
  assert.equal(run(key, 'maybe').status, 2);
  const all = run(key, 'on', '--all');
  assert.match(all.stdout, /is on for all projects/);
  assert.equal(JSON.parse(readFileSync(GLOBAL, 'utf8')).habits[key], true);
});
