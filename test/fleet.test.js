import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';
import { parseCardLine } from '../src/board.js';
import { runCard } from '../src/card.js';
import { HABITS, habitStates } from '../src/habits.js';
import { blockRanges, dropRun, fleetBranch, mergeCard, preflight, reviewPack, runDir, runPageHtml, scanDiff, sendBack, unlock } from '../src/fleet.js';

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

// The lane and the Doing card line for card id on a board.
const doingLine = (dir, id) => {
  const board = readFileSync(join(dir, 'pm', 'board.md'), 'utf8');
  const doing = board.split('## Doing')[1].split('## Needs your look')[0];
  return doing.split('\n').find((l) => l.startsWith(`- #${id} `)) ?? null;
};

test('preflight moves its card to Doing at the stage the run starts at (#266)', () => {
  const dir = repo();
  preflight(dir, 1, { pid: 1, isAlive: () => false });
  assert.match(doingLine(dir, 1), / · fleet · design$/, 'no run files yet: plan, so design');
  assert.doesNotMatch(readFileSync(join(dir, 'pm', 'board.md'), 'utf8').split('## Doing')[0], /#1 /, 'it left Up next');
  // A card already in Doing gets its stage updated.
  writeFileSync(join(runDir(dir, 1), 'plan.md'), 'plan\n');
  writeFileSync(join(runDir(dir, 1), 'design.md'), 'design\n');
  preflight(dir, 1, { pid: 1, isAlive: () => false });
  assert.match(doingLine(dir, 1), / · fleet · develop$/, 'plan and design written, no build: develop');
  writeFileSync(join(runDir(dir, 1), 'build.md'), 'build\n');
  preflight(dir, 1, { pid: 1, isAlive: () => false });
  assert.match(doingLine(dir, 1), / · fleet · test$/, 'review on: test');
});

test('a refused preflight leaves the board and the lock alone (#266)', () => {
  const dir = repo();
  writeFileSync(join(dir, 'pm', 'board.md'), BOARD.replace('- #2 No done when yet · M1 · 2 pts', '- #2 No points yet · M1\n  done when: it works'));
  const before = readFileSync(join(dir, 'pm', 'board.md'), 'utf8');
  assert.throws(() => preflight(dir, 2, { pid: 1, isAlive: () => false }), /no story points/);
  assert.equal(readFileSync(join(dir, 'pm', 'board.md'), 'utf8'), before);
  assert.equal(existsSync(join(runDir(dir, 2), 'lock')), false);
});

test('two fleet runs leave both cards in Doing at once (#266)', () => {
  const dir = repo();
  writeFileSync(join(dir, 'pm', 'board.md'), BOARD.replace('- #2 No done when yet · M1 · 2 pts', '- #2 Draw the chart · M1 · 2 pts · look\n  done when: the chart shows'));
  preflight(dir, 1, { pid: 1, isAlive: () => false });
  preflight(dir, 2, { pid: 2, isAlive: () => false });
  assert.ok(doingLine(dir, 1), '#1 is still in Doing');
  assert.ok(doingLine(dir, 2), '#2 is in Doing beside it');
});

test('the rules let fleet runs sit in Doing together (#266)', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const rules = readFileSync(join(root, 'rules.md'), 'utf8').replace(/\n\s*/g, ' ');
  const standing = readFileSync(join(root, '.claude', 'CLAUDE.md'), 'utf8').split('\n').find((l) => l.startsWith('3. '));
  for (const text of [rules.match(/Keep the board live:[^.]*\./)[0], standing]) {
    assert.match(text, /one (card )?at a time, except fleet runs/, text);
    assert.match(text, /several can be (there|in Doing) at once/, text);
  }
  assert.match(standing, /\(From retro of M16, #145\.\)/);
  const skill = readFileSync(join(root, 'skills', 'fleet', 'SKILL.md'), 'utf8').replace(/\n\s*/g, ' ');
  assert.match(skill, /moves the card to Doing/);
});

test('soloagile fleet preflight and unlock run from the command line', () => {
  const dir = repo();
  const run = (...a) => spawnSync('node', [PM, 'fleet', ...a], { cwd: dir, encoding: 'utf8' });
  const pre = run('preflight', '1');
  assert.equal(pre.status, 0, pre.stderr);
  assert.match(pre.stdout, /#1 is locked for its fleet run\nsoloagile: start at plan/);
  assert.match(pre.stdout, /#1 is in Doing, at design/);
  assert.ok(existsSync(join(dir, 'pm', 'index.html')), 'the page is rebuilt');
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
  assert.match(skill, /give\s+Milo\s+its\s+output\s+whole\s+and\s+nothing\s+else/);
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

// Milo's pack (#268): a sample change on card-1 against main, in a repo with a long code
// file of small top-level functions (f100 to f199, four lines each with a comment above)
// and a short README.
const BIG = Array.from({ length: 100 }, (_, i) => `// f${100 + i} adds\nfunction f${100 + i}() {\n  return ${100 + i};\n}\n`).join('');
const packRepo = (change) => {
  const dir = repo();
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, stdio: 'pipe' });
  git('branch', '-M', 'main');
  writeFileSync(join(dir, 'big.js'), BIG);
  writeFileSync(join(dir, 'README.md'), Array.from({ length: 20 }, (_, i) => `Readme line ${i + 1}`).join('\n') + '\n');
  writeFileSync(join(dir, 'old.js'), 'export const gone = 1;\n');
  git('add', 'big.js', 'README.md', 'old.js', 'pm/board.md');
  git('commit', '-qm', 'files');
  git('checkout', '-qb', 'card-1');
  change(dir, git);
  git('commit', '-qam', 'card');
  git('checkout', '-q', 'main');
  mkdirSync(runDir(dir, 1), { recursive: true });
  writeFileSync(join(runDir(dir, 1), 'plan.md'), 'ZEBRAPLAN: build it this way\n');
  writeFileSync(join(runDir(dir, 1), 'build.md'), 'ZEBRABUILD: built\n');
  return dir;
};
const edit = (dir, file, from, to) => writeFileSync(join(dir, file), readFileSync(join(dir, file), 'utf8').replace(from, to));

test("Milo's pack has the done when, the diff, and each changed function or short file whole (#268)", () => {
  const dir = packRepo((d) => {
    edit(d, 'big.js', '  return 150;', '  return 150 + 1;');
    edit(d, 'README.md', 'Readme line 7\n', 'Readme line seven\n');
  });
  const pack = reviewPack(dir, 1);
  assert.match(pack, /^## Done when\n\ndone when: the feed parses\n/);
  assert.match(pack, /## The change\n[\s\S]*-  return 150;\n\+  return 150 \+ 1;/);
  assert.match(pack, /### big\.js lines 201-204\n/);
  const block = pack.split('### big.js lines 201-204')[1].split('###')[0];
  assert.match(block, /201 {2}\/\/ f150 adds\n202 {2}function f150\(\) \{\n203 {2} {2}return 150 \+ 1;\n204 {2}\}\n/);
  const full = pack.split('## Changed code in full')[1];
  assert.doesNotMatch(full, /return 149;|return 151;|function f149|function f151/, 'not the neighbours (the diff has its own three lines of context)');
  assert.match(pack, /### README\.md \(whole file\)\n/);
  assert.match(pack.split('### README.md (whole file)')[1], /Readme line 1\n[\s\S]*Readme line seven\n[\s\S]*Readme line 20\n/);
  assert.doesNotMatch(pack, /Parse the feed/, 'no card title');
  assert.doesNotMatch(pack, /ZEBRAPLAN|ZEBRABUILD/, 'no plan or build notes');
});

test("a new short file is in Milo's pack whole, a deleted one only in the diff (#268)", () => {
  const dir = packRepo((d, git) => {
    writeFileSync(join(d, 'sum.js'), 'export const sum = (xs) => xs.reduce((a, b) => a + b, 0);\n');
    git('add', 'sum.js');
    git('rm', '-q', 'old.js');
  });
  const pack = reviewPack(dir, 1);
  assert.match(pack, /### sum\.js \(whole file\)\n`{3,}\nexport const sum/);
  assert.match(pack, /-export const gone = 1;/, 'the deletion is in the diff');
  assert.doesNotMatch(pack, /### old\.js/);
});

test("two changes in neighbouring blocks give one merged range in Milo's pack (#268)", () => {
  const dir = packRepo((d) => {
    edit(d, 'big.js', '  return 150;', '  return 150 + 1;');
    edit(d, 'big.js', '  return 151;', '  return 151 + 1;');
    edit(d, 'big.js', '  return 170;', '  return 170 + 1;');
  });
  const pack = reviewPack(dir, 1);
  assert.deepEqual(pack.match(/### big\.js lines \d+-\d+/g), ['### big.js lines 201-208', '### big.js lines 281-284']);
});

test('soloagile fleet review <n> prints the pack and exits 0 (#268)', () => {
  const dir = packRepo((d) => edit(d, 'big.js', '  return 150;', '  return 150 + 1;'));
  const r = spawnSync('node', [PM, 'fleet', 'review', '1'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${reviewPack(dir, 1)}\n`);
  assert.match(r.stdout, /### big\.js lines 201-204/);
});

test("the fleet skill gives Milo the review pack, and he still has no tools (#268)", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const skill = readFileSync(join(root, 'skills', 'fleet', 'SKILL.md'), 'utf8');
  const step4 = skill.split('**4. Blind review')[1].split('**5.')[0];
  assert.match(step4, /soloagile fleet review <n>/);
  assert.match(step4, /over\s+300\s+lines,\s+or\s+any\s+file\s+over\s+60\s+KB,\s+comes\s+as\s+its\s+changed\s+regions\s+with\s+20\s+lines/);
  assert.match(step4, /files\s+under\s+`pm\/`\s+are\s+in\s+the\s+diff\s+alone/);
  assert.match(step4, /over\s+120\s+KB\s+it\s+gives\s+the\s+diff\s+alone/);
  assert.doesNotMatch(step4, /git diff main\.\.\.card-<n>/);
  const milo = readFileSync(join(root, 'agents', 'milo.md'), 'utf8');
  assert.match(milo, /^tools: \[\]$/m);
  assert.match(milo, /in full/);
  assert.match(milo, /Never invent a line that isn't in what you were given/);
});

// Rework round 1 (#268): size limits, pm/ left out, odd entries, and the block rule's edges.
const fullPart = (pack) => pack.split('## Changed code in full')[1];
const sizeLine = (pack) => {
  const at = pack.lastIndexOf('\n\n');
  const m = pack.slice(at + 2).match(/^Size: (\d+) bytes \(\d+ KB\) above this line\.$/);
  assert.ok(m, `the pack ends with its size line: ${JSON.stringify(pack.slice(-120))}`);
  assert.equal(Number(m[1]), Buffer.byteLength(pack.slice(0, at)));
};

test("Milo's pack ends with a line giving its size (#268)", () => {
  const dir = packRepo((d) => edit(d, 'big.js', '  return 150;', '  return 150 + 1;'));
  sizeLine(reviewPack(dir, 1));
});

test("a long non-code file gives its changed regions with 20 lines around, numbered (#268)", () => {
  const json = `{\n${Array.from({ length: 400 }, (_, i) => `  "k${i + 1}": ${i + 1},`).join('\n')}\n  "last": 0\n}\n`;
  const dir = packRepo((d, git) => {
    writeFileSync(join(d, 'data.json'), json);
    git('add', 'data.json');
  });
  // a second commit on card-1 edits the json's line 201 ("k200"), so main has no data.json
  // and the file is new; edit on main instead so the change is one line.
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, stdio: 'pipe' });
  git('checkout', '-q', '-b', 'tmp', 'main');
  writeFileSync(join(dir, 'data.json'), json);
  git('add', 'data.json');
  git('commit', '-qm', 'json');
  git('branch', '-f', 'main', 'tmp');
  git('checkout', '-q', 'card-1');
  git('rebase', '-q', 'main');
  edit(dir, 'data.json', '"k200": 200,', '"k200": 2000,');
  git('commit', '-qam', 'edit json');
  git('checkout', '-q', 'main');
  git('branch', '-q', '-D', 'tmp');
  const full = fullPart(reviewPack(dir, 1));
  assert.match(full, /### data\.json lines 181-221\n/);
  assert.match(full, /181 {2} {2}"k180": 180,\n/);
  assert.match(full, /201 {2} {2}"k200": 2000,\n/);
  assert.match(full, /221 {2} {2}"k220": 220,\n/);
  assert.doesNotMatch(full, /"k179"|"k221"|\(whole file\)/);
});

test("a file over 60 KB gives its changed regions only, even when short (#268)", () => {
  const long = Array.from({ length: 100 }, (_, i) => `const v${i + 1} = '${'x'.repeat(700)}';`).join('\n') + '\n';
  const dir = packRepo((d, git) => {
    git('checkout', '-q', 'main');
    writeFileSync(join(d, 'wide.js'), long);
    git('add', 'wide.js');
    git('commit', '-qm', 'wide');
    git('checkout', '-q', 'card-1');
    git('rebase', '-q', 'main');
    edit(d, 'wide.js', "const v50 = '", "const v50 = 'y");
  });
  const full = fullPart(reviewPack(dir, 1));
  assert.deepEqual(full.match(/### wide\.js[^\n]*/g), ['### wide.js lines 30-70']);
});

test("over 120 KB the pack gives the diff alone, with a note saying so (#268)", () => {
  const dir = packRepo((d, git) => {
    for (const name of ['a.js', 'b.js', 'c.js']) writeFileSync(join(d, name), `${`// ${'z'.repeat(500)}\n`.repeat(100)}`);
    git('add', 'a.js', 'b.js', 'c.js');
  });
  const pack = reviewPack(dir, 1);
  const full = fullPart(pack);
  assert.doesNotMatch(full, /###/);
  assert.match(full, /would be \d+ KB, over 120 KB, so Milo has the diff alone/);
  assert.match(pack.split('## Changed code in full')[0], /\+\/\/ z{500}/, 'the diff is still there');
  sizeLine(pack);
});

test("files under pm/ are left out of the changed code in full, but stay in the diff (#268)", () => {
  const dir = packRepo((d, git) => {
    mkdirSync(join(d, 'pm', 'runs', '1'), { recursive: true });
    writeFileSync(join(d, 'pm', 'runs', '1', 'build.md'), 'ZEBRABUILD: built\n');
    edit(d, 'pm/board.md', '## Ideas\n', '## Ideas\n- #3 ZEBRABOARD · M1 · 1 pt\n');
    edit(d, 'big.js', '  return 150;', '  return 150 + 1;');
    git('add', 'pm');
  });
  const pack = reviewPack(dir, 1);
  const full = fullPart(pack);
  assert.doesNotMatch(full, /ZEBRABUILD|ZEBRABOARD|### pm\//);
  assert.match(full, /### big\.js lines 201-204/);
  assert.match(pack.split('## Changed code in full')[0], /\+ZEBRABUILD[\s\S]*\+- #3 ZEBRABOARD|\+- #3 ZEBRABOARD[\s\S]*\+ZEBRABUILD/, 'both are in the diff');
});

test("an empty changed-code part says why: only deletions, only pm/, or both (#268)", () => {
  const del = packRepo((d, git) => git('rm', '-q', 'old.js'));
  assert.match(fullPart(reviewPack(del, 1)), /^\n\nNone: the change only deletes files, so they are in the diff alone\.\n/);
  const pm = packRepo((d) => edit(d, 'pm/board.md', '## Ideas\n', '## Ideas\n- #3 Idea\n'));
  assert.match(fullPart(reviewPack(pm, 1)), /^\n\nNone: the change only touches files under pm\/, which are in the diff alone\.\n/);
  const both = packRepo((d, git) => {
    git('rm', '-q', 'old.js');
    edit(d, 'pm/board.md', '## Ideas\n', '## Ideas\n- #3 Idea\n');
  });
  assert.match(fullPart(reviewPack(both, 1)), /^\n\nNone: the change only deletes files and touches files under pm\/, which are in the diff alone\.\n/);
});

test("a binary file and a mode change are listed by name (#268)", () => {
  const dir = packRepo((d, git) => {
    writeFileSync(join(d, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 0, 0xff]));
    git('add', 'logo.png');
    chmodSync(join(d, 'README.md'), 0o755);
  });
  const full = fullPart(reviewPack(dir, 1));
  assert.match(full, /### logo\.png \(binary, not shown\)/);
  assert.match(full, /### README\.md \(mode change only\)/);
  assert.doesNotMatch(full, /Readme line/);
});

test("a submodule, or anything git show can't print, is listed by name (#268)", () => {
  // A gitlink to a commit this repo doesn't have; its empty folder keeps commit -a from
  // taking it for a deletion.
  const dir = packRepo((d, git) => {
    mkdirSync(join(d, 'vendor', 'lib'), { recursive: true });
    git('update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},vendor/lib`);
    edit(d, 'big.js', '  return 150;', '  return 150 + 1;');
  });
  const full = fullPart(reviewPack(dir, 1));
  assert.match(full, /### vendor\/lib \(submodule, not shown\)/);
});

test("a pure deletion in a long file gives the block it was in (#268)", () => {
  const dir = packRepo((d) => edit(d, 'big.js', '  return 150;\n', ''));
  const full = fullPart(reviewPack(dir, 1));
  assert.deepEqual(full.match(/### big\.js[^\n]*/g), ['### big.js lines 201-203']);
  assert.match(full, /202 {2}function f150\(\) \{\n203 {2}\}\n/);
});

test("a changed comment line belongs to the block below it (#268)", () => {
  const dir = packRepo((d) => edit(d, 'big.js', '// f150 adds\n', '// f150 adds one\n'));
  const full = fullPart(reviewPack(dir, 1));
  assert.deepEqual(full.match(/### big\.js[^\n]*/g), ['### big.js lines 201-204']);
});

test("block rule: shell and Ruby closers end a block, a decorator joins the one below (#268)", () => {
  const sh = ['if [ -n "$a" ]; then', '  echo a', 'fi', 'for x in 1 2; do', '  echo $x', 'done', 'case $a in', '  b) echo b ;;', 'esac', 'def ruby', '  1', 'end', 'next=1'];
  assert.deepEqual(blockRanges(sh, [2]), [[1, 3]]);
  assert.deepEqual(blockRanges(sh, [5]), [[4, 6]]);
  assert.deepEqual(blockRanges(sh, [8]), [[7, 9]]);
  assert.deepEqual(blockRanges(sh, [11]), [[10, 12]]);
  const py = ['x = 1', '', '# cached', '@cache', '@wraps(f)', 'def g():', '    return 2', '', 'y = 3'];
  assert.deepEqual(blockRanges(py, [7]), [[3, 7]]);
  assert.deepEqual(blockRanges(py, [4]), [[3, 7]], 'a changed decorator gives the block below');
});

test("Milo's pack has every done when line of the card (#268)", () => {
  const dir = packRepo((d) => edit(d, 'big.js', '  return 150;', '  return 150 + 1;'));
  edit(dir, 'pm/board.md', '  done when: the feed parses\n', '  done when: the feed parses\n  done when: and its dates are kept\n');
  assert.match(reviewPack(dir, 1), /^## Done when\n\ndone when: the feed parses\ndone when: and its dates are kept\n\n## The change/);
});

test("Milo's pack refuses a card not on the board, one with no done when, and a git failure (#268)", () => {
  const dir = packRepo((d) => edit(d, 'big.js', '  return 150;', '  return 150 + 1;'));
  assert.throws(() => reviewPack(dir, 9), /#9 isn't on the board/);
  assert.throws(() => reviewPack(dir, 2), /#2 has no done when/);
  assert.throws(() => reviewPack(repo(), 1), /^Error: git diff/);
  const r = spawnSync('node', [PM, 'fleet', 'review', '9'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /#9 isn't on the board/);
});

test("a long fenced text gets a fence longer than its longest run of backticks (#268)", () => {
  const dir = packRepo((d, git) => {
    writeFileSync(join(d, 'ticks.md'), `${'`'.repeat(7)}\n${'a`b\n'.repeat(500000)}`);
    git('add', 'ticks.md');
  });
  assert.doesNotThrow(() => reviewPack(dir, 1));
});
