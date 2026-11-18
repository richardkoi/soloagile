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
import { dropRun, fleetBranch, mergeCard, preflight, runDir, runPageHtml, scanDiff, sendBack, unlock } from '../src/fleet.js';

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
  assert.match(tobin, /^tools: Read, Edit, Write, Bash, Glob, Grep, Skill$/m);
  assert.match(tobin, /^maxTurns: \d+$/m);
  const skill = readFileSync(join(root, 'skills', 'fleet', 'SKILL.md'), 'utf8');
  assert.match(skill, /subagent_type: "soloagile:tobin"/);
  assert.match(skill, /soloagile fleet preflight <n>/);
  assert.match(skill, /don't restart or message him for more turns/);
});

test('Milo reviews blind: no tools, a different model from Tobin, and two rework rounds at most', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const milo = readFileSync(join(root, 'agents', 'milo.md'), 'utf8');
  assert.match(milo, /^model: sonnet$/m);
  assert.match(milo, /^tools: \[\]$/m);
  const skill = readFileSync(join(root, 'skills', 'fleet', 'SKILL.md'), 'utf8');
  assert.match(skill, /subagent_type:\s+"soloagile:milo"/);
  assert.match(skill, /only\s+the\s+card.s\s+"done\s+when"\s+lines\s+and\s+that\s+diff/);
  assert.match(skill, /Two\s+rework\s+rounds\s+at\s+most/);
  assert.match(skill, /a\s+new\s+Agent\s+call,\s+never\s+a\s+message\s+to\s+the\s+old\s+one/);
});

test('the security scan flags keys, tokens, .env, logins and permissions in added lines, with file and line', () => {
  const diff = `diff --git a/src/api.js b/src/api.js
--- a/src/api.js
+++ b/src/api.js
@@ -10,3 +10,6 @@ export function call() {
   const url = base;
+  const headers = { Authorization: \`Bearer \${process.env.API_TOKEN}\` };
+  return fetch(url, { headers });
-  const old = 1;
+  login(user, password);
 }
diff --git a/.env b/.env
--- /dev/null
+++ b/.env
@@ -0,0 +1 @@
+X=1
diff --git a/deploy.sh b/deploy.sh
--- a/deploy.sh
+++ b/deploy.sh
@@ -1,1 +1,2 @@
 #!/bin/sh
+chmod 777 /srv/app
`;
  const hits = scanDiff(diff);
  assert.deepEqual(hits.map((h) => `${h.file}:${h.line}`), ['src/api.js:11', 'src/api.js:13', '.env:0', 'deploy.sh:2']);
  assert.equal(hits[0].why, 'a key or token');
  assert.equal(hits.at(-1).why, 'a permission');
  // Found in a real run (#238): Rufus caught a chmodSync to 0o777 the first scan missed.
  assert.equal(scanDiff('+++ b/x.js\n@@ -0,0 +1 @@\n+require("fs").chmodSync("/srv", 0o777);\n')[0]?.why, 'a permission');
});

test('a quiet change has no hits, so Rufus never starts', () => {
  const diff = `--- a/stats.js
+++ b/stats.js
@@ -0,0 +1,2 @@
+export const average = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
+// the author of this line likes sessions of music
`;
  assert.deepEqual(scanDiff(diff), []);
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  assert.match(readFileSync(join(root, 'agents', 'rufus.md'), 'utf8'), /^tools: \[\]$/m);
  assert.match(readFileSync(join(root, 'skills', 'fleet', 'SKILL.md'), 'utf8'), /With no hits it says so and exits 0: write nothing, start\s+no one/);
});

test('soloagile fleet scan reads card-<n> against main and exits 1 on a hit', () => {
  const dir = repo();
  execFileSync('git', ['branch', '-M', 'main'], { cwd: dir });
  const { path } = fleetBranch(dir, 1);
  const commit = (file, text) => {
    writeFileSync(join(path, file), text);
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'x'], { cwd: path });
  };
  writeFileSync(join(path, 'quiet.js'), 'export const two = 2;\n');
  execFileSync('git', ['add', 'quiet.js'], { cwd: path });
  commit('quiet.js', 'export const two = 2;\n');
  const quiet = spawnSync('node', [PM, 'fleet', 'scan', '1'], { cwd: dir, encoding: 'utf8' });
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.match(quiet.stdout, /no security list needed/);
  commit('quiet.js', 'export const two = 2;\nexport const key = process.env.SECRET;\n');
  const loud = spawnSync('node', [PM, 'fleet', 'scan', '1'], { cwd: dir, encoding: 'utf8' });
  assert.equal(loud.status, 1);
  assert.match(loud.stdout, /quiet\.js:2  a key or token/);
});

test("the fleet's last stage runs the project's checks and links report.md from the card", () => {
  const skill = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'fleet', 'SKILL.md'), 'utf8');
  assert.match(skill, /pm\/runs\/<n>\/report\.md/);
  assert.match(skill, /`## Checks` in `pm\/overview\.md`/);
  assert.match(skill, /soloagile card note <n> "report: pm\/runs\/<n>\/report\.md"/);
});

const built = () => {
  const dir = repo();
  execFileSync('git', ['branch', '-M', 'main'], { cwd: dir });
  const { path } = fleetBranch(dir, 1);
  writeFileSync(join(path, 'sum.js'), 'export const sum = (xs) => xs.reduce((a, b) => a + b, 0);\n');
  execFileSync('git', ['add', 'sum.js'], { cwd: path });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'sum'], { cwd: path });
  mkdirSync(runDir(dir, 1), { recursive: true });
  for (const f of ['plan.md', 'build.md', 'review.md', 'verdicts.md', 'security-list.md', 'report.md']) writeFileSync(join(runDir(dir, 1), f), f);
  return { dir, path };
};
const branches = (dir) => execFileSync('git', ['branch', '--format=%(refname:short)'], { cwd: dir, encoding: 'utf8' }).trim().split('\n');

test("yes merges card-<n> into main and removes its copy and branch", () => {
  const { dir, path } = built();
  assert.equal(mergeCard(dir, 1).into, 'main');
  assert.ok(existsSync(join(dir, 'sum.js')));
  assert.equal(existsSync(path), false);
  assert.deepEqual(branches(dir), ['main']);
});

test('a merge that would carry uncommitted changes is refused', () => {
  const { dir } = built();
  writeFileSync(join(dir, 'app.js'), 'changed\n');
  assert.throws(() => mergeCard(dir, 1), /uncommitted changes, so nothing was merged/);
  assert.ok(branches(dir).includes('card-1'));
});

test('send back keeps the plan and the branch, so the next run resumes at build', () => {
  const { dir } = built();
  assert.deepEqual(sendBack(dir, 1).sort(), ['build.md', 'report.md', 'review.md', 'security-list.md', 'verdicts.md']);
  assert.ok(existsSync(join(runDir(dir, 1), 'plan.md')));
  assert.ok(branches(dir).includes('card-1'));
  assert.equal(preflight(dir, 1, { pid: 1, isAlive: () => false }).stage, 'build');
});

test('drop removes the copy, the branch and the run files', () => {
  const { dir, path } = built();
  dropRun(dir, 1);
  assert.equal(existsSync(path), false);
  assert.deepEqual(branches(dir), ['main']);
  assert.equal(existsSync(runDir(dir, 1)), false);
  const needs = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'needs', 'SKILL.md'), 'utf8');
  assert.match(needs, /"Yes, merge it",\s+"Send it back", "Drop it"/);
});

test("a fleet run gets one page, its files stacked, and the card's pop-up links it", async () => {
  const { block } = await import('../src/page.js');
  const { buildProject } = await import('../src/build.js');
  const dir = repo();
  writeFileSync(join(dir, 'pm', 'plan.md'), '# Plan\n\n## Milestones\n### M1 — First · in progress\nshort: first\nCards: #1, #2\n');
  mkdirSync(runDir(dir, 1), { recursive: true });
  writeFileSync(join(runDir(dir, 1), 'plan.md'), '# Plan for #1\n\nChange **sum.js**. <script>x</script>\n');
  writeFileSync(join(runDir(dir, 1), 'report.md'), '# Report\n\nAll passed.\n');
  const html = runPageHtml(1, { 'plan.md': readFileSync(join(runDir(dir, 1), 'plan.md'), 'utf8'), 'report.md': 'All passed.' }, block);
  assert.match(html, /<h1>Fleet run · #1<\/h1>/);
  assert.match(html, /<h2>Plan<\/h2><p>Change <strong>sum\.js<\/strong>/);
  assert.doesNotMatch(html, /<script>/, 'a helper-written file is shown, never run');
  assert.match(html, /<h2>Blind review<\/h2><p class="none">Didn't run\.<\/p>/);
  assert.match(html, /<h2>Security list<\/h2><p class="none">No hits in the scan/);
  buildProject(dir);
  assert.ok(existsSync(join(dir, 'pm', 'docs', 'run-1.html')));
  const page = readFileSync(join(dir, 'pm', 'index.html'), 'utf8');
  assert.match(page, /href="docs\/run-1\.html"[^>]*>.*Fleet run<\/a>/);
  assert.doesNotMatch(page, /docs\/run-2\.html/);
});

test('an away run hands a fleet card to the fleet skill, never to a parallel helper', () => {
  const away = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'away', 'SKILL.md'), 'utf8');
  assert.match(away, /run the fleet\s+skill on it \(`\/soloagile:fleet <n>`\)/);
  assert.match(away, /never give a fleet card to a helper/);
  const tools = away.match(/^allowed-tools: (.*)$/m)[1];
  for (const t of ['Agent', 'Skill', 'Bash(soloagile fleet:*)', 'Bash(git worktree:*)']) assert.ok(tools.includes(t), t);
});

test('Cora designs a card with a screen before the build and checks its pictures after', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const cora = readFileSync(join(root, 'agents', 'cora.md'), 'utf8');
  assert.match(cora, /^name: cora$/m);
  assert.match(cora, /one recommendation/);
  assert.match(cora, /phone and\s+desktop, light and dark/);
  const skill = readFileSync(join(root, 'skills', 'fleet', 'SKILL.md'), 'utf8');
  assert.ok(skill.indexOf('soloagile:cora') < skill.indexOf('soloagile:tobin'), 'design comes before the build');
  assert.match(skill, /picture-check\.md/);
  assert.match(skill, /`## Choice for the user`, make it a\s+Needs your decision card/);
  const html = runPageHtml(5, { 'plan.md': 'p', 'report.md': 'r' }, (s) => s);
  assert.match(html, /<h2>Design<\/h2><p class="none">No screen in this card, so no design\.<\/p>/);
});

test('a card marked look runs only Cora and Tobin: no blind review, no security list', () => {
  const skill = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'fleet', 'SKILL.md'), 'utf8');
  assert.match(skill, /A card marked `look` takes the short path/);
  assert.match(skill, /Skip Milo's review, the fact-check and the security list/);
});

test('Orla names the skills each worker loads, and Tobin and Cora can load them', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const skill = readFileSync(join(root, 'skills', 'fleet', 'SKILL.md'), 'utf8');
  assert.match(skill, /a `## Skills` section\s+naming, for Tobin and for Cora, the installed skills that fit this card and why/);
  for (const name of ['tobin', 'cora']) {
    const agent = readFileSync(join(root, 'agents', `${name}.md`), 'utf8');
    assert.match(agent, /^tools: .*\bSkill$/m, name);
    assert.match(agent, /load each with the Skill tool/, name);
  }
});
