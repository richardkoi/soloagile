import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';
import { parseCardLine } from '../src/board.js';
import { runCard } from '../src/card.js';
import { HABITS, habitStates } from '../src/habits.js';
import { blockRanges, cardBase, cardDiff, costLines, dropRun, fleetBranch, mergeCard, preflight, recordUsageStart, reviewPack, runCost, runDir, runPageHtml, scanCard, scanDiff, scanText, sendBack, unlock, updateBranch, updateText } from '../src/fleet.js';
import { maskUrl, readUsage } from '../src/usage.js';

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

test('fleet branch <n> --from <m> makes card-<n> from card-<m> and records it as the base (#270)', () => {
  const dir = repo();
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
  const first = fleetBranch(dir, 1);
  writeFileSync(join(first.path, 'app.js'), '2\n');
  git(first.path, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'card 1');
  const run = (...a) => spawnSync('node', [PM, 'fleet', 'branch', ...a], { cwd: dir, encoding: 'utf8' });
  const made = run('2', '--from', '1');
  assert.equal(made.status, 0, made.stderr);
  assert.match(made.stdout, /made #2's copy on branch card-2 from card-1: /);
  assert.equal(git(dir, 'rev-parse', 'card-2'), git(dir, 'rev-parse', 'card-1'), "card-2 starts at card-1's tip");
  assert.equal(git(dir, 'config', 'branch.card-2.fleetBase'), 'card-1');
  assert.match(run('2', '--from', '#1').stdout, /found #2's copy on branch card-2; --from ignored, the branch exists: /);
  const bare = run('3', '--from');
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /usage: soloagile fleet .*branch <card> \[--from <card>\]/);
});

test('the fleet skill shoots a copy with shots --card and builds on another card with --from (#270)', () => {
  const skill = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'fleet', 'SKILL.md'), 'utf8');
  assert.match(skill, /soloagile shots --card <n>/);
  assert.match(skill, /soloagile fleet branch\s+<n> --from <m>/);
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

// #269: the words that tripped the scan on #259, #260, #265 and #266, none of them in code.
const added = (file, ...lines) => `--- a/${file}\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}\n`;

test('session is not a login word; cookie still is (#260)', () => {
  assert.deepEqual(scanDiff(added('test/refresh.test.js', "  assert.equal(seen.flow.title, 'Session flow - PM');")), []);
  assert.equal(scanDiff(added('src/a.js', 'const cookie = req.headers.cookie;'))[0]?.why, 'a login or password');
});

test('the scan skips whole-comment lines, and URLs are code (#259, #260)', () => {
  assert.deepEqual(scanDiff(added('template/guide.html', '<!-- The command guide: one list, in the order of a session. It is a modal <dialog> opened -->')), []);
  assert.deepEqual(scanDiff(added('template/guide.html', '<!-- The command guide: one list, in the order of a session.', 'It is a modal <dialog> opened from the token button', '-->', '<p>a session cookie</p>')).map((h) => h.line), [4], 'a comment over lines is skipped, the line after is not');
  // The comment opened in a context line, before the hunk's added lines.
  assert.deepEqual(scanDiff('--- a/t.html\n+++ b/t.html\n@@ -1,2 +1,3 @@\n <!-- the guide\n+opened from the token button\n -->\n'), []);
  assert.deepEqual(scanDiff(added('template/refresh.js', '  // the "Session flow" tab, and its auth cookie', '  /* the token', '   * and the password */')), []);
  assert.deepEqual(scanDiff(added('deploy.sh', '  # read the api_key from vault')), []);
  assert.deepEqual(scanDiff(added('config.yml', '# the token lives elsewhere', 'name: app')), []);
  assert.equal(scanDiff(added('deploy.sh', '#!/bin/sh token'))[0]?.why, 'a key or token', 'a shebang is not a comment');
  assert.equal(scanDiff(added('src/a.js', '# a token'))[0]?.why, 'a key or token', '# is a comment only in the # languages');
  assert.equal(scanDiff(added('src/a.js', 'const api_key = x; // note'))[0]?.why, 'a key or token');
  assert.equal(scanDiff(added('src/a.js', "fetch('https://x.test/token')"))[0]?.why, 'a key or token', 'a URL is not cut as a comment');
});

test('Markdown prose is skipped, its fenced code is scanned (#266)', () => {
  assert.deepEqual(scanDiff(added('skills/fleet/SKILL.md', 'the run stops here: no token has been spent.', 'Use `api_key` in prose.')), []);
  const hits = scanDiff(added('README.md', 'Set the key:', '', '```bash', 'export API_KEY=abc', '```', 'and the token is set.'));
  assert.deepEqual(hits.map((h) => `${h.line} ${h.why}`), ['4 a key or token']);
  // A fence opened in a context line before the hunk.
  assert.equal(scanDiff('--- a/a.md\n+++ b/a.md\n@@ -1,2 +1,3 @@\n ~~~\n+password = 1\n ~~~\n')[0]?.why, 'a login or password');
});

// A repo on main where card-1 adds a risky line and card-2, made from card-1, a quiet one.
const stacked = () => {
  const dir = repo();
  execFileSync('git', ['branch', '-M', 'main'], { cwd: dir });
  const commit = (path, file, text) => {
    writeFileSync(join(path, file), text);
    execFileSync('git', ['add', file], { cwd: path });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', file], { cwd: path });
  };
  commit(fleetBranch(dir, 1).path, 'risky.js', 'export const key = process.env.SECRET;\n');
  commit(fleetBranch(dir, 2, { from: 'card-1' }).path, 'quiet.js', 'export const two = 2;\n');
  return dir;
};

test("the scan compares a card against the branch it was built on (#265)", () => {
  const dir = stacked();
  assert.equal(execFileSync('git', ['config', '--get', 'branch.card-2.fleetBase'], { cwd: dir, encoding: 'utf8' }).trim(), 'card-1');
  assert.equal(cardBase(dir, 2), 'card-1');
  assert.equal(cardBase(dir, 1), 'main', 'unset, it is the branch checked out in the main tree');
  assert.equal(cardBase(join(dir, '.claude', 'worktrees', 'card-1'), 1), 'main', 'the main tree, even from a copy');
  assert.deepEqual(scanDiff(cardDiff(dir, 2)), []);
  assert.deepEqual(scanDiff(cardDiff(dir, 2, 'main')).map((h) => h.file), ['risky.js']);
});

test('soloagile fleet scan names its base, and --base overrides it', () => {
  const dir = stacked();
  const own = spawnSync('node', [PM, 'fleet', 'scan', '2'], { cwd: dir, encoding: 'utf8' });
  assert.equal(own.status, 0, own.stderr);
  assert.match(own.stdout, /against card-1/);
  const main = spawnSync('node', [PM, 'fleet', 'scan', '2', '--base', 'main'], { cwd: dir, encoding: 'utf8' });
  assert.equal(main.status, 1);
  assert.match(main.stdout, /against main/);
  assert.match(main.stdout, /risky\.js:1  a key or token/);
});

// Round 1 of #269's review: one test per upheld finding.
test('fleetBranch with from makes the new branch from it, and records it only then', () => {
  const dir = stacked();
  const under = (a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: dir }).status === 0;
  assert.ok(under('card-1', 'card-2'), 'card-2 is made from card-1, not from main');
  fleetBranch(dir, 3);
  fleetBranch(dir, 3, { from: 'card-1' });
  assert.equal(spawnSync('git', ['config', '--get', 'branch.card-3.fleetBase'], { cwd: dir }).status, 1, 'not recorded on a later call');
  assert.ok(!under('card-1', 'card-3'));
});

// The literals are built in pieces so this file holds none whole.
const BEGIN = '-----BEGIN RSA ' + 'PRIVATE KEY-----';
test('key material is a hit in comments and prose too; the words stay code-only', () => {
  assert.equal(scanDiff(added('src/a.js', '// ' + 'ghp' + '_abcdefghijklmnopqrstuvwxyz0123'))[0]?.why, 'a key or token');
  assert.equal(scanDiff(added('deploy.sh', '# ' + 'sk' + '-abcdefghijklmnop'))[0]?.why, 'a key or token');
  assert.equal(scanDiff(added('README.md', 'Paste it here: ' + BEGIN))[0]?.why, 'a key or token');
  assert.equal(scanDiff(added('a.html', '<!-- ' + 'xoxb' + '-1234567890abcdef -->'))[0]?.why, 'a key or token');
  assert.deepEqual(scanDiff(added('src/a.js', '// the api_key and the client_secret')), []);
  assert.deepEqual(scanDiff(added('README.md', 'Keep the private key and the secret safe.')), []);
});

test('code after a closing */ or --> is scanned; a leading * is a comment only inside /*', () => {
  assert.equal(scanDiff(added('src/a.js', '/* note */ const token = t;'))[0]?.why, 'a key or token');
  assert.equal(scanDiff(added('a.html', '<!-- note --> <input name="password">'))[0]?.why, 'a login or password');
  assert.deepEqual(scanDiff(added('src/a.js', '/* the', ' * token */ const password = p;')).map((h) => h.line), [2]);
  assert.equal(scanDiff(added('src/a.js', 'const n = a', '  * cookie.length;'))[0]?.why, 'a login or password');
});

test('an extensionless file is a # language unless its shebang is node, deno or bun', () => {
  const line = 'console.log(`card #${id}`, process.env.X)';
  assert.equal(scanDiff(added('bin/tool', '#!/usr/bin/env node', line))[0]?.why, 'a .env file');
  assert.equal(scanDiff(added('bin/tool', '#!/usr/bin/env -S deno run', line))[0]?.why, 'a .env file');
  assert.deepEqual(scanDiff(added('bin/tool', '#!/bin/sh', '# the token')), []);
  assert.deepEqual(scanDiff(added('Dockerfile', '# the token comes later')), []);
});

// A file on main whose fence and shebang sit far above the card's change. The tool's new
// line is a JS private field: a # comment unless the node shebang is known.
test('fleet scan reads the whole file, so a far fence and a node shebang are known', () => {
  const dir = repo();
  execFileSync('git', ['branch', '-M', 'main'], { cwd: dir });
  const steps = Array.from({ length: 8 }, (_, i) => `echo step ${i}`);
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'README.md'), ['# Setup', '', '```bash', ...steps, 'export NAME=x', '```', ''].join('\n'));
  writeFileSync(join(dir, 'bin', 'tool'), ['#!/usr/bin/env node', ...steps.map((s) => `// ${s}`), ''].join('\n'));
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'docs'], { cwd: dir });
  const { path } = fleetBranch(dir, 1);
  writeFileSync(join(path, 'README.md'), readFileSync(join(path, 'README.md'), 'utf8').replace('NAME=x', 'API_KEY=abc'));
  writeFileSync(join(path, 'bin', 'tool'), readFileSync(join(path, 'bin', 'tool'), 'utf8') + '#key = process.env.X;\n');
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'x'], { cwd: path });
  assert.deepEqual(scanDiff(cardDiff(dir, 1)), [], "plain cardDiff keeps git's 3 lines of context");
  assert.deepEqual(scanDiff(cardDiff(dir, 1, 'main', { context: 'all' })).map((h) => `${h.file}:${h.line}`), ['README.md:12', 'bin/tool:10']);
  const out = spawnSync('node', [PM, 'fleet', 'scan', '1'], { cwd: dir, encoding: 'utf8' });
  assert.equal(out.status, 1);
  assert.match(out.stdout, /README\.md:12  a key or token/);
  assert.match(out.stdout, /bin\/tool:10  a \.env file/);
});

test('fleet scan --base with no branch is a usage error', () => {
  const dir = stacked();
  const r = spawnSync('node', [PM, 'fleet', 'scan', '2', '--base'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});

// Round 2 of #269's review: one test per upheld finding.
test('a # or // inside a string keeps the rest of the line', () => {
  assert.equal(scanDiff(added('deploy.sh', 'echo "card #$id"; chmod 777 x'))[0]?.why, 'a permission');
  assert.equal(scanDiff(added('tool.py', 'print(f"issue #{n}"); os.environ["X"]'))[0]?.why, 'a .env file');
});

// #275: a trailing comment outside quotes is cut; token and login words inside _ names hit.
test('a trailing comment outside quotes is not scanned (#275)', () => {
  assert.deepEqual(scanDiff(added('deploy.sh', 'echo hi # the token')), []);
  assert.deepEqual(scanDiff(added('src/a.js', 'const x = 1; // the token')), []);
  assert.deepEqual(scanDiff(added('src/a.js', "const u = 'http://x'; // the token")), []);
  assert.equal(scanDiff(added('deploy.sh', 'echo "card #$id"; chmod 777 x'))[0]?.why, 'a permission', 'the # is inside quotes');
  assert.equal(scanDiff(added('deploy.sh', 'echo "a \\" # b"; chmod 777 x'))[0]?.why, 'a permission', 'an escaped quote keeps the string open');
  assert.equal(scanDiff(added('deploy.sh', 'echo $#; chmod 777 x'))[0]?.why, 'a permission', 'a # after no space is not a comment');
  assert.equal(scanDiff(added('src/a.js', "fetch('https://x.test/token')"))[0]?.why, 'a key or token', 'a URL is not cut as a comment');
  assert.equal(scanDiff(added('src/a.js', 'fetch(u, { auth }); // https://x'))[0]?.why, 'a login or password');
});

test('token and login words hit inside _ names and after :_ (#275)', () => {
  const rc = '.' + 'npmrc';
  assert.equal(scanDiff(added('deploy.sh', 'export NPM_AUTH' + '_TOKEN=x'))[0]?.why, 'a key or token');
  assert.equal(scanDiff(added('deploy.sh', 'export GITHUB' + '_TOKEN=x'))[0]?.why, 'a key or token');
  assert.equal(scanDiff(added(rc, '//registry.npmjs.org/:_auth' + '=dXNlcjpw'))[0]?.why, 'a login or password');
  assert.equal(scanDiff(added(rc, '//registry.npmjs.org/:_pass' + 'word=abc'))[0]?.why, 'a login or password');
  assert.deepEqual(scanDiff(added('src/a.js', 'const tokens = getTokenCount(author);')), [], 'a word inside a longer word is no hit');
});

test('comment syntax goes by file type; any other file is scanned whole', () => {
  assert.deepEqual(scanDiff(added('deploy.sh', '/* x', 'chmod 777 y')).map((h) => `${h.line} ${h.why}`), ['2 a permission'], '/* opens nothing in a .sh');
  const rc = '.' + 'npmrc';
  assert.equal(scanDiff(added(rc, '//registry.npmjs.org/:_auth' + 'Token=${NPM}'))[0]?.why, 'a key or token', '// is no comment in that dotfile');
  assert.equal(scanDiff(added('data.json', '# the token'))[0]?.why, 'a key or token');
  assert.equal(scanDiff(added('notes.txt', '<!-- the password -->'))[0]?.why, 'a login or password');
  assert.equal(scanDiff(added('a.py', '<!-- the password'))[0]?.why, 'a login or password', '<!-- opens nothing in a .py');
  assert.equal(scanDiff(added('a.css', '# the token'))[0]?.why, 'a key or token', '# is no comment in .css');
  assert.deepEqual(scanDiff(added('a.go', '// the token', '/* the password */')), []);
  assert.deepEqual(scanDiff(added('icon.svg', '<!-- the token -->')), []);
  assert.deepEqual(scanDiff(added('Makefile', '# the token')), []);
  assert.deepEqual(scanDiff(added('a.rb', '# the token')), []);
  assert.deepEqual(scanDiff(added('run.zsh', '# the token')), []);
});

test('an npm token is key material, in a comment too', () => {
  const npm = 'npm' + '_' + 'a1B2c3D4e5'.repeat(3) + 'f6G7h8';
  assert.equal(scanDiff(added('conf.txt', 'x=' + npm))[0]?.why, 'a key or token');
  assert.equal(scanDiff(added('src/a.js', '// ' + npm))[0]?.why, 'a key or token');
  assert.equal(scanDiff(added('README.md', 'like ' + npm))[0]?.why, 'a key or token');
});

test('a stored base that is gone falls back to the main tree branch, and the scan runs', () => {
  const dir = stacked();
  execFileSync('git', ['worktree', 'remove', '--force', join(dir, '.claude', 'worktrees', 'card-1')], { cwd: dir });
  execFileSync('git', ['branch', '-D', 'card-1'], { cwd: dir });
  assert.equal(cardBase(dir, 2), 'main');
  const r = spawnSync('node', [PM, 'fleet', 'scan', '2'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /against main/);
});

test('when the whole-file diff fails, the scan falls back to the 3-line diff and says so', () => {
  const dir = repo();
  execFileSync('git', ['branch', '-M', 'main'], { cwd: dir });
  writeFileSync(join(dir, 'big.js'), Array.from({ length: 300 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'big'], { cwd: dir });
  const { path } = fleetBranch(dir, 1);
  writeFileSync(join(path, 'big.js'), readFileSync(join(path, 'big.js'), 'utf8').replace('v150 = 150', 'token = 150'));
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'x'], { cwd: path });
  assert.throws(() => cardDiff(dir, 1, 'main', { context: 'all', maxBuffer: 2000 }));
  const narrow = scanCard(dir, 1, 'main', { maxBuffer: 2000 });
  assert.equal(narrow.narrow, true);
  assert.deepEqual(narrow.hits.map((h) => `${h.file}:${h.line}`), ['big.js:151']);
  assert.match(scanText(1, narrow.hits, 'main', narrow).split('\n')[0], /3-line diff/);
  const whole = scanCard(dir, 1, 'main');
  assert.equal(whole.narrow, false);
  assert.doesNotMatch(scanText(1, whole.hits, 'main', whole), /3-line diff/);
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

// Round 3 (#268): into a pipe, console.log then process.exit cut the pack at 64 KB.
test('soloagile fleet review <n> sends a pack over 64 KB whole through a slow pipe (#268)', () => {
  const dir = packRepo((d, git) => {
    // a new 45 KB file: its diff and its code in full make a pack of about 90 KB
    writeFileSync(join(d, 'wide.js'), `${`// ${'q'.repeat(450)}\n`.repeat(100)}`);
    git('add', 'wide.js');
  });
  const want = `${reviewPack(dir, 1)}\n`;
  assert.ok(Buffer.byteLength(want) > 70000, `the pack is over 70 KB: ${Buffer.byteLength(want)}`);
  for (let i = 0; i < 3; i++) {
    // the reader waits before it reads, so the pipe fills and Node is still writing at exit
    const r = spawnSync('sh', ['-c', `node "${PM}" fleet review 1 | (sleep 0.2; cat)`], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 24 });
    assert.equal(Buffer.byteLength(r.stdout), Buffer.byteLength(want), `try ${i + 1}: all of it arrived`);
    sizeLine(r.stdout.slice(0, -1));
  }
});

test("the fleet skill gives Milo the review pack, and he still has no tools (#268)", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const skill = readFileSync(join(root, 'skills', 'fleet', 'SKILL.md'), 'utf8');
  const step4 = skill.split('**4. Blind review')[1].split('**5.')[0];
  assert.match(step4, /soloagile fleet review <n>/);
  assert.match(step4, /non-code\s+file\s+over\s+300\s+lines\s+or\s+60\s+KB\s+comes\s+as\s+its\s+changed\s+regions\s+with\s+20\s+lines/);
  assert.match(step4, /code\s+file\s+keeps\s+whole\s+blocks\s+whatever\s+its\s+size/);
  assert.match(step4, /Files\s+under\s+a\s+top-level\s+`pm\/`\s+are\s+left\s+out\s+of\s+the\s+pack\s+entirely,\s+named\s+only/);
  assert.match(step4, /over\s+120\s+KB\s+it\s+gives\s+the\s+diff\s+alone/);
  assert.match(step4, /too\s+big\s+for\s+a\s+blind\s+review/);
  assert.match(step4, /`git\s+diff\s+--stat`\s+line/);
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

test("a non-code file over 60 KB gives its changed regions only, even when short (#268)", () => {
  const long = Array.from({ length: 100 }, (_, i) => `v${i + 1} = '${'x'.repeat(700)}'`).join('\n') + '\n';
  const dir = packRepo((d, git) => {
    git('checkout', '-q', 'main');
    writeFileSync(join(d, 'wide.txt'), long);
    git('add', 'wide.txt');
    git('commit', '-qm', 'wide');
    git('checkout', '-q', 'card-1');
    git('rebase', '-q', 'main');
    edit(d, 'wide.txt', "v50 = '", "v50 = 'y");
  });
  const full = fullPart(reviewPack(dir, 1));
  assert.deepEqual(full.match(/### wide\.txt[^\n]*/g), ['### wide.txt lines 30-70']);
});

test("over 120 KB the pack gives the diff alone, with a note saying so (#268)", () => {
  const dir = packRepo((d, git) => {
    // two new files of 35 KB: the diff alone is 70 KB, with the code in full 140 KB
    for (const name of ['a.js', 'b.js']) writeFileSync(join(d, name), `${`// ${'z'.repeat(350)}\n`.repeat(100)}`);
    git('add', 'a.js', 'b.js');
  });
  const pack = reviewPack(dir, 1);
  const full = fullPart(pack);
  assert.doesNotMatch(full, /###/);
  assert.match(full, /would be \d+ KB, over 120 KB, so Milo has the diff alone/);
  assert.match(pack.split('## Changed code in full')[0], /\+\/\/ z{350}/, 'the diff is still there');
  sizeLine(pack);
});

test("files under pm/ are left out of the pack entirely, named by path only (#268)", () => {
  const dir = packRepo((d, git) => {
    mkdirSync(join(d, 'pm', 'runs', '1'), { recursive: true });
    writeFileSync(join(d, 'pm', 'runs', '1', 'build.md'), 'ZEBRABUILD: built\n');
    // the board change carries the card's title, as a moved card would
    edit(d, 'pm/board.md', '## Doing\n', '## Doing\n- #1 Parse the feed · M1 · 3 pts · fleet\n');
    edit(d, 'big.js', '  return 150;', '  return 150 + 1;');
    git('add', 'pm');
  });
  const pack = reviewPack(dir, 1);
  assert.doesNotMatch(pack, /ZEBRABUILD/, 'no build notes, in the diff or anywhere');
  assert.doesNotMatch(pack, /Parse the feed/, 'no card title');
  assert.doesNotMatch(pack, /### pm\/|diff --git a\/pm\//);
  assert.match(pack, /\nLeft out of the pack: pm\/board\.md, pm\/runs\/1\/build\.md\n/);
  assert.match(fullPart(pack), /### big\.js lines 201-204/);
  assert.match(pack, /\+  return 150 \+ 1;/, 'the code change is still in the diff');
  sizeLine(pack);
});

test("only a top-level pm/ is left out: src/pm/x.js is shown in full (#268)", () => {
  const dir = packRepo((d, git) => {
    mkdirSync(join(d, 'src', 'pm'), { recursive: true });
    writeFileSync(join(d, 'src', 'pm', 'x.js'), 'export const x = 1;\n');
    git('add', 'src');
  });
  const pack = reviewPack(dir, 1);
  assert.match(pack, /\+export const x = 1;/);
  assert.match(fullPart(pack), /### src\/pm\/x\.js \(whole file\)\n`{3,}\nexport const x = 1;/);
  assert.doesNotMatch(pack, /Left out of the pack/);
});

test("a deleted pm/ file is named only, not in the diff (#268)", () => {
  const dir = packRepo((d, git) => {
    git('checkout', '-q', 'main');
    mkdirSync(join(d, 'pm', 'runs', '1'), { recursive: true });
    writeFileSync(join(d, 'pm', 'runs', '1', 'old.md'), 'ZEBRAOLD notes\n');
    git('add', 'pm');
    git('commit', '-qm', 'old notes');
    git('checkout', '-q', 'card-1');
    git('rebase', '-q', 'main');
    git('rm', '-q', 'pm/runs/1/old.md');
    edit(d, 'big.js', '  return 150;', '  return 150 + 1;');
  });
  const pack = reviewPack(dir, 1);
  assert.doesNotMatch(pack, /ZEBRAOLD/);
  assert.match(pack, /\nLeft out of the pack: pm\/runs\/1\/old\.md\n/);
});

test("a diff alone over 120 KB gives each file's stat line and says it is too big for a blind review (#268)", () => {
  const dir = packRepo((d, git) => {
    writeFileSync(join(d, 'huge.js'), `${'// ZEBRAHUGE '.repeat(40)}\n`.repeat(300));
    git('add', 'huge.js');
    edit(d, 'big.js', '  return 150;', '  return 150 + 1;');
  });
  const pack = reviewPack(dir, 1);
  assert.doesNotMatch(pack, /ZEBRAHUGE/, 'neither the diff nor the code');
  assert.match(pack, /^## Done when\n\ndone when: the feed parses\n/);
  assert.match(pack, /Too big for a blind review/);
  assert.match(pack, /\n ?big\.js +\| +2 \+-\n/);
  assert.match(pack, /\n ?huge\.js +\| +300 \++\n/);
  assert.doesNotMatch(pack, /### /);
  sizeLine(pack);
});

test("a code file over 60 KB keeps the whole function round its changed line (#268)", () => {
  const body = Array.from({ length: 200 }, (_, i) => `  total += ${i}; // ${'w'.repeat(400)}`).join('\n');
  const src = `function long() {\n  let total = 0;\n${body}\n  return total;\n}\n\nfunction other() {\n  return 2;\n}\n`;
  const dir = packRepo((d, git) => {
    git('checkout', '-q', 'main');
    writeFileSync(join(d, 'long.js'), src);
    git('add', 'long.js');
    git('commit', '-qm', 'long');
    git('checkout', '-q', 'card-1');
    git('rebase', '-q', 'main');
    edit(d, 'long.js', '  total += 100;', '  total += 1000;');
  });
  const full = fullPart(reviewPack(dir, 1));
  assert.deepEqual(full.match(/### long\.js[^\n]*/g), ['### long.js lines 1-204']);
  assert.match(full, /\n {2}1 {2}function long\(\) \{\n/);
  assert.match(full, /\n204 {2}\}\n/);
  assert.doesNotMatch(full, /function other/);
});

test("an indented changed comment stays in its own block, not the one below (#268)", () => {
  const filler = Array.from({ length: 300 }, (_, i) => `v${i} = ${i}`).join('\n');
  const dir = packRepo((d, git) => {
    git('checkout', '-q', 'main');
    writeFileSync(join(d, 'mod.py'), `def f():\n    x = 1\n    # note\ndef g():\n    return 2\n${filler}\n`);
    git('add', 'mod.py');
    git('commit', '-qm', 'py');
    git('checkout', '-q', 'card-1');
    git('rebase', '-q', 'main');
    edit(d, 'mod.py', '    # note\n', '    # a note\n');
  });
  const full = fullPart(reviewPack(dir, 1));
  assert.deepEqual(full.match(/### mod\.py[^\n]*/g), ['### mod.py lines 1-3']);
  assert.doesNotMatch(full, /def g/);
});

test("a pure deletion at the end of a long non-code file gives the region before it (#268)", () => {
  const md = Array.from({ length: 400 }, (_, i) => `Note line ${i + 1}`).join('\n') + '\n';
  const dir = packRepo((d, git) => {
    git('checkout', '-q', 'main');
    writeFileSync(join(d, 'notes.md'), md);
    git('add', 'notes.md');
    git('commit', '-qm', 'notes');
    git('checkout', '-q', 'card-1');
    git('rebase', '-q', 'main');
    edit(d, 'notes.md', 'Note line 400\n', '');
  });
  const pack = reviewPack(dir, 1);
  assert.match(pack, /-Note line 400\n/);
  const full = fullPart(pack);
  assert.deepEqual(full.match(/### notes\.md[^\n]*/g), ['### notes.md lines 379-399']);
  assert.match(full, /399 {2}Note line 399\n`/);
});

test("an empty changed-code part says why: only deletions, only pm/, or both (#268)", () => {
  const del = packRepo((d, git) => git('rm', '-q', 'old.js'));
  assert.match(fullPart(reviewPack(del, 1)), /^\n\nNone: the change only deletes files, so they are in the diff alone\.\n/);
  const pm = packRepo((d) => edit(d, 'pm/board.md', '## Ideas\n', '## Ideas\n- #3 Idea\n'));
  assert.match(fullPart(reviewPack(pm, 1)), /^\n\nNone: the change only touches files under pm\/, which are left out of the pack\.\n/);
  const both = packRepo((d, git) => {
    git('rm', '-q', 'old.js');
    edit(d, 'pm/board.md', '## Ideas\n', '## Ideas\n- #3 Idea\n');
  });
  assert.match(fullPart(reviewPack(both, 1)), /^\n\nNone: the change only deletes files, which are in the diff alone, and touches files under pm\/, which are left out of the pack\.\n/);
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

const NC = " (reset not checked: usageResets isn't set)";

// What a run cost (#271). Never the real TokenSentinel: usage is passed in, or read through a
// get that throws, or from a settings folder with no usage address.
test("a run's cost: each window's share, with the numbers it went between (#271)", () => {
  const text = costLines({ pcts: { week: 4, '5 hours': 54 } }, { pcts: { week: 4.6, '5 hours': 61 } });
  assert.equal(text, `## Cost\n- the week: 0.6% of the limit (4% → 4.6%)${NC}\n- the 5 hours: 7.0% of the limit (54% → 61%)${NC}`);
});

test("a run's cost is not measured when TokenSentinel doesn't answer, or wasn't read at the start (#271)", async () => {
  const dir = repo();
  await recordUsageStart(dir, 1, { pct: 4, pcts: { week: 4, '5 hours': 54 } });
  const down = await readUsage({ usageUrl: 'http://u.test/budget' }, async () => { throw new Error('refused'); });
  const text = await runCost(dir, 1, { usage: down });
  assert.equal(text, "## Cost\n- not measured: couldn't read http://u.test/budget: refused");
  const said = costLines({ said: 'no usage address set' }, { pcts: { week: 5 } });
  assert.equal(said, '## Cost\n- not measured: no usage address set');
  assert.match(await runCost(dir, 2, { usage: { pcts: { week: 5 } } }), /not measured: no usage was recorded at the run's start/);
});

test("a window that reset during the run isn't measured (#271)", () => {
  const text = costLines({ pcts: { week: 40, '5 hours': 90 } }, { pcts: { week: 41, '5 hours': 12 } });
  assert.match(text, /- the 5 hours: not measured, it reset during the run/);
  assert.match(text, /- the week: 1.0% of the limit \(40% → 41%\)/);
});

test("other runs that overlapped are named, since their cost is in it too (#271)", async () => {
  const dir = repo();
  const at = (m) => new Date(Date.UTC(2026, 10, 18, 10, m));
  await recordUsageStart(dir, 1, { pcts: { week: 4 } }, { now: at(0) });
  await recordUsageStart(dir, 268, { pcts: { week: 4.1 } }, { now: at(5) });
  mkdirSync(runDir(dir, 269), { recursive: true });
  writeFileSync(join(runDir(dir, 269), 'lock'), JSON.stringify({ pid: 9, started: at(10).toISOString() }));
  await recordUsageStart(dir, 250, { pcts: { week: 3 } }, { now: new Date(Date.UTC(2026, 10, 17)) }); // the day before: not shared
  const text = await runCost(dir, 1, { usage: { pcts: { week: 5 } }, now: at(30) });
  assert.match(text, /\n- shared with #268, #269: their runs ran at the same time, so this counts them too$/);
});

test('a resumed run keeps the usage from its first start (#271)', async () => {
  const dir = repo();
  assert.equal(await recordUsageStart(dir, 1, { pcts: { week: 4 } }, { now: new Date('2026-11-18T10:00:00Z') }), true);
  assert.equal(await recordUsageStart(dir, 1, { pcts: { week: 9 } }, { now: new Date('2026-11-18T12:00:00Z') }), false);
  assert.deepEqual(JSON.parse(readFileSync(join(runDir(dir, 1), 'usage-start.json'), 'utf8')), { at: '2026-11-18T10:00:00.000Z', pcts: { week: 4 } });
  await recordUsageStart(dir, 2, { pct: null, said: 'no usage address set' });
  assert.equal(JSON.parse(readFileSync(join(runDir(dir, 2), 'usage-start.json'), 'utf8')).said, 'no usage address set');
});

test('soloagile fleet cost <n> says not measured with no usage address, and exits 0 (#271)', () => {
  const dir = repo();
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  const env = { ...process.env, HOME: home, SOLOAGILE_DIR: home };
  const run = (...a) => spawnSync('node', [PM, 'fleet', ...a], { cwd: dir, encoding: 'utf8', env });
  assert.equal(run('preflight', '1').status, 0);
  assert.match(readFileSync(join(runDir(dir, 1), 'usage-start.json'), 'utf8'), /no usage address set/, 'preflight records the start');
  const cost = run('cost', '1');
  assert.equal(cost.status, 0, cost.stderr);
  assert.match(cost.stdout, /^## Cost\n- not measured: no usage address set/);
});

test("the fleet skill's report ends with soloagile fleet cost (#271)", () => {
  const skill = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'fleet', 'SKILL.md'), 'utf8');
  const step7 = skill.slice(skill.indexOf('**7. Test and notes'), skill.indexOf('**8. '));
  assert.match(step7, /report\.md ends with the output of\s+`soloagile fleet cost <n>`/);
});

// Round 1 rework (#271).
const TS = (five, week, fiveReset = 27, weekReset = 9927) => async () => ({
  json: async () => ({ windows: { five_hour: { used_pct: five, minutes_to_reset: fiveReset }, seven_day: { used_pct: week, minutes_to_reset: weekReset } } }),
});
const TS_SETTINGS = { usageUrl: 'http://u.test/budget', usagePaths: { week: 'windows.seven_day.used_pct', '5 hours': 'windows.five_hour.used_pct' } };

test("a run's cost through readUsage with TokenSentinel's JSON gives both windows measured (#271)", async () => {
  const dir = repo();
  await recordUsageStart(dir, 1, await readUsage(TS_SETTINGS, TS(60.0, 5.0)));
  const text = await runCost(dir, 1, { usage: await readUsage(TS_SETTINGS, TS(64.0, 5.5)) });
  assert.equal(text, `## Cost\n- the week: 0.5% of the limit (5% → 5.5%)${NC}\n- the 5 hours: 4.0% of the limit (60% → 64%)${NC}`);
});

test('usageResets: a window whose reset time passed during the run is not measured (#271)', async () => {
  const settings = { ...TS_SETTINGS, usageResets: { week: 'windows.seven_day.minutes_to_reset', '5 hours': 'windows.five_hour.minutes_to_reset' } };
  const u = await readUsage(settings, TS(60.0, 5.0));
  assert.deepEqual(u.resets, { week: 9927, '5 hours': 27 });
  assert.equal((await readUsage(TS_SETTINGS, TS(60.0, 5.0))).resets, undefined, 'no resets without the setting');
  const dir = repo();
  const start = new Date('2026-11-18T10:00:00Z');
  await recordUsageStart(dir, 1, u, { now: start });
  const saved = JSON.parse(readFileSync(join(runDir(dir, 1), 'usage-start.json'), 'utf8'));
  assert.deepEqual(saved.resetAt, { week: new Date(start.getTime() + 9927 * 60000).toISOString(), '5 hours': '2026-11-18T10:27:00.000Z' });
  // 5 hours went 60 → 70, higher at the end, but its reset time (10:27) passed by 10:40.
  const end = await readUsage(settings, TS(70.0, 5.5));
  const text = await runCost(dir, 1, { usage: end, now: new Date('2026-11-18T10:40:00Z') });
  assert.match(text, /- the 5 hours: not measured, it reset during the run/);
  assert.match(text, /- the week: 0\.5% of the limit \(5% → 5\.5%\)/);
  const atReset = await runCost(dir, 1, { usage: end, now: new Date('2026-11-18T10:28:00Z') });
  assert.match(atReset, /- the 5 hours: not measured, it reset during the run/, 'a minute after the reset time counts');
  const before = await runCost(dir, 1, { usage: end, now: new Date('2026-11-18T10:20:00Z') });
  assert.match(before, /- the 5 hours: 10\.0% of the limit \(60% → 70%\)/);
});

test('a start saved with no numbers is replaced by a later one with numbers; one with numbers is kept (#271)', async () => {
  const dir = repo();
  const file = join(runDir(dir, 1), 'usage-start.json');
  assert.equal(await recordUsageStart(dir, 1, { pct: null, said: 'refused' }, { now: new Date('2026-11-18T10:00:00Z') }), true);
  assert.equal(await recordUsageStart(dir, 1, { pct: 4, pcts: { week: 4 } }, { now: new Date('2026-11-18T11:00:00Z') }), true);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { at: '2026-11-18T11:00:00.000Z', pcts: { week: 4 }, replaced: '2026-11-18T10:00:00.000Z' });
  assert.equal(await recordUsageStart(dir, 1, { pct: 9, pcts: { week: 9 } }, { now: new Date('2026-11-18T12:00:00Z') }), false);
  assert.equal(await recordUsageStart(dir, 1, { pct: null, said: 'refused' }), false);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).pcts, { week: 4 });
});

test('a run that started earlier and is still running overlaps; one that finished before the start does not (#271)', async () => {
  const dir = repo();
  const at = (m) => new Date(Date.UTC(2026, 10, 18, 10, m));
  await recordUsageStart(dir, 1, { pcts: { week: 4 } }, { now: at(30) });
  // #270 started 20 minutes before #1 and still holds its lock.
  await recordUsageStart(dir, 270, { pcts: { week: 3.9 } }, { now: at(10) });
  writeFileSync(join(runDir(dir, 270), 'lock'), JSON.stringify({ pid: 9, started: at(10).toISOString() }));
  // #260 started at 10:00 and wrote its report.md at 10:20, before #1 started: not shared.
  await recordUsageStart(dir, 260, { pcts: { week: 3.5 } }, { now: at(0) });
  writeFileSync(join(runDir(dir, 260), 'report.md'), '# report\n');
  utimesSync(join(runDir(dir, 260), 'report.md'), at(20), at(20));
  // #261 started at 10:00 with no lock, and wrote its report.md at 10:40, after #1 started: shared.
  await recordUsageStart(dir, 261, { pcts: { week: 3.5 } }, { now: at(0) });
  writeFileSync(join(runDir(dir, 261), 'report.md'), '# report\n');
  utimesSync(join(runDir(dir, 261), 'report.md'), at(40), at(40));
  const text = await runCost(dir, 1, { usage: { pcts: { week: 5 } }, now: at(50), isAlive: (pid) => pid === 9 });
  assert.match(text, /\n- shared with #261, #270: their runs ran at the same time, so this counts them too$/);
});

test("an unreadable or empty usage-start.json is not measured, and fleet cost exits 0 (#271)", async () => {
  const dir = repo();
  mkdirSync(runDir(dir, 1), { recursive: true });
  writeFileSync(join(runDir(dir, 1), 'usage-start.json'), '');
  assert.equal(await runCost(dir, 1, { usage: { pcts: { week: 5 } } }), "## Cost\n- not measured: the start reading couldn't be read");
  writeFileSync(join(runDir(dir, 1), 'usage-start.json'), '{"at": ');
  assert.equal(await runCost(dir, 1, { usage: { pcts: { week: 5 } } }), "## Cost\n- not measured: the start reading couldn't be read");
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  const cost = spawnSync('node', [PM, 'fleet', 'cost', '1'], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: home, SOLOAGILE_DIR: home } });
  assert.equal(cost.status, 0, cost.stderr);
  assert.match(cost.stdout, /not measured: the start reading couldn't be read/);
});

test('the share always has one decimal, and the readings are shown as given (#271)', () => {
  assert.equal(costLines({ pcts: { week: 60 } }, { pcts: { week: 67 } }), `## Cost\n- the week: 7.0% of the limit (60% → 67%)${NC}`);
  assert.equal(costLines({ pcts: { week: 40.2 } }, { pcts: { week: 40.8 } }), `## Cost\n- the week: 0.6% of the limit (40.2% → 40.8%)${NC}`);
  assert.equal(costLines({ pcts: { week: 0.1 + 0.2 } }, { pcts: { week: 5 } }), `## Cost\n- the week: 4.7% of the limit (0.3% → 5%)${NC}`);
  assert.equal(costLines({ pcts: { week: 12 } }, { pcts: { week: 12 } }), `## Cost\n- the week: 0.0% of the limit (12% → 12%)${NC}`);
});

test("a usage address's login and query are masked before they are saved or printed (#271)", async () => {
  const dir = repo();
  const url = 'http://me:hunter2@u.test/budget?token=abc123';
  const down = await readUsage({ usageUrl: url }, async () => { throw new Error(`refused ${url}`); });
  assert.match(down.said, /http:\/\/\*\*\*@u\.test\/budget\?…/);
  await recordUsageStart(dir, 1, down);
  const saved = readFileSync(join(runDir(dir, 1), 'usage-start.json'), 'utf8');
  const printed = await runCost(dir, 1, { usage: down });
  for (const text of [down.said, saved, printed]) {
    assert.doesNotMatch(text, /hunter2|abc123|me:/);
  }
  const noNumber = await readUsage({ usageUrl: url, usagePath: 'nope' }, async () => ({ json: async () => ({}) }));
  assert.doesNotMatch(noNumber.said, /hunter2|abc123/);
  assert.match(noNumber.said, /http:\/\/\*\*\*@u\.test\/budget\?… gave no number at nope/);
  const plain = await readUsage({ usageUrl: 'http://127.0.0.1:8787/budget' }, async () => { throw new Error('refused'); });
  assert.equal(plain.said, "couldn't read http://127.0.0.1:8787/budget: refused", 'an address with no login or query is shown as it is');
});

// Round 2 rework (#271).
test('round 2: a reset value counts only when it is a number above 0 (#271)', async () => {
  const settings = { ...TS_SETTINGS, usageResets: { week: 'windows.seven_day.minutes_to_reset', '5 hours': 'windows.five_hour.minutes_to_reset' } };
  for (const bad of [null, '', 0, -5, '30']) {
    const u = await readUsage(settings, TS(60.0, 5.0, bad, 9927));
    assert.deepEqual(u.resets, { week: 9927 }, `5 hours reset ${JSON.stringify(bad)}`);
  }
});

test("round 2: a measured window with no reset time says its reset wasn't checked (#271)", () => {
  const start = { pcts: { week: 4, '5 hours': 54 }, resetAt: { week: '2026-11-25T10:00:00.000Z' } };
  const text = costLines(start, { pcts: { week: 4.6, '5 hours': 61 } }, { now: new Date('2026-11-18T11:00:00Z') });
  assert.equal(text, "## Cost\n- the week: 0.6% of the limit (4% → 4.6%)\n- the 5 hours: 7.0% of the limit (54% → 61%) (reset not checked: usageResets isn't set)");
});

test('round 2: a replaced start says so in the cost (#271)', async () => {
  const dir = repo();
  await recordUsageStart(dir, 1, { pct: null, said: 'refused' }, { now: new Date('2026-11-18T10:00:00Z') });
  await recordUsageStart(dir, 1, { pct: 4, pcts: { week: 4 } }, { now: new Date('2026-11-18T11:00:00Z') });
  const saved = JSON.parse(readFileSync(join(runDir(dir, 1), 'usage-start.json'), 'utf8'));
  assert.equal(saved.replaced, '2026-11-18T10:00:00.000Z');
  const text = await runCost(dir, 1, { usage: { pcts: { week: 5 } }, now: new Date('2026-11-18T12:00:00Z') });
  assert.match(text, /\n- measured from 2026-11-18T11:00:00\.000Z; the first reading at 2026-11-18T10:00:00\.000Z failed$/);
  // A first start with numbers is never marked replaced.
  await recordUsageStart(dir, 2, { pct: 4, pcts: { week: 4 } });
  assert.equal(JSON.parse(readFileSync(join(runDir(dir, 2), 'usage-start.json'), 'utf8')).replaced, undefined);
});

test("round 2: another run's lock counts only while its pid is alive (#271)", async () => {
  const dir = repo();
  const at = (m) => new Date(Date.UTC(2026, 10, 18, 10, m));
  await recordUsageStart(dir, 1, { pcts: { week: 4 } }, { now: at(30) });
  // #270 started before #1 and left a lock behind; its pid is gone.
  await recordUsageStart(dir, 270, { pcts: { week: 3.9 } }, { now: at(10) });
  writeFileSync(join(runDir(dir, 270), 'lock'), JSON.stringify({ pid: 4242, started: at(10).toISOString() }));
  const dead = await runCost(dir, 1, { usage: { pcts: { week: 5 } }, now: at(50), isAlive: () => false });
  assert.doesNotMatch(dead, /shared with/);
  const live = await runCost(dir, 1, { usage: { pcts: { week: 5 } }, now: at(50), isAlive: (pid) => pid === 4242 });
  assert.match(live, /- shared with #270:/);
});

test("round 2: a window whose reading isn't a number is not measured (#271)", () => {
  const text = costLines({ pcts: { week: null, '5 hours': 'x' } }, { pcts: { week: 5, '5 hours': 61 } });
  assert.equal(text, "## Cost\n- the week: not measured, the reading isn't a number\n- the 5 hours: not measured, the reading isn't a number");
  assert.equal(costLines({ pcts: { week: 4 } }, { pcts: { week: '5' } }), "## Cost\n- the week: not measured, the reading isn't a number");
});

test('round 2: the address hides a # fragment, and any login in the error text (#271)', async () => {
  assert.equal(maskUrl('http://host/budget#key=x'), 'http://host/budget#…');
  assert.equal(maskUrl('http://me:pw@host/budget?t=1#k'), 'http://***@host/budget?…');
  const settings = { usageUrl: 'http://me:pw@host/budget' };
  const u = await readUsage(settings, async () => { throw new Error('fetch http://me:pw@host/budget/ failed, see https://a:b@other/x'); });
  assert.doesNotMatch(u.said, /me:pw|a:b/);
  assert.match(u.said, /http:\/\/\*\*\*@host\/budget\/ failed, see https:\/\/\*\*\*@other\/x/);
});

test("round 2: a window resets only a minute after its reset time (#271)", () => {
  const start = { pcts: { week: 60 }, resetAt: { week: '2026-11-18T10:27:00.000Z' } };
  const end = { pcts: { week: 70 } };
  assert.match(costLines(start, end, { now: new Date('2026-11-18T10:27:30Z') }), /- the week: 10\.0% of the limit/);
  assert.match(costLines(start, end, { now: new Date('2026-11-18T10:28:00Z') }), /- the week: not measured, it reset during the run/);
});

// #267: a fleet branch is brought up to date with main before Milo's review.
const T = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const commitIn = (cwd, file, text, msg = 'x') => {
  writeFileSync(join(cwd, file), text);
  execFileSync('git', ['add', file], { cwd });
  execFileSync('git', [...T, 'commit', '-qm', msg], { cwd });
};
const onMain = () => {
  const dir = repo();
  execFileSync('git', ['branch', '-M', 'main'], { cwd: dir });
  return dir;
};

test('fleet update brings a branch level with main, then says it is current (#267)', () => {
  const dir = onMain();
  const { path } = fleetBranch(dir, 1);
  commitIn(path, 'a.txt', 'card one\n');
  commitIn(dir, 'b.txt', 'main moved\n');
  assert.deepEqual(updateBranch(dir, 1), { state: 'merged', base: 'main', path });
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', 'main', 'card-1'], { cwd: dir }).status, 0, 'main is in card-1');
  assert.ok(existsSync(join(path, 'b.txt')));
  assert.deepEqual(updateBranch(dir, 1), { state: 'current', base: 'main', path });
});

test('two cards changing the same file both reach review clashing-free (#267)', () => {
  const dir = onMain();
  const one = fleetBranch(dir, 1).path;
  const two = fleetBranch(dir, 2).path;
  commitIn(one, 'app.js', 'one\n');
  commitIn(two, 'app.js', 'two\n');
  // The first card through is already level with main before its review.
  assert.ok(['current', 'merged'].includes(updateBranch(dir, 1).state));
  mergeCard(dir, 1);
  const clash = updateBranch(dir, 2);
  assert.deepEqual(clash, { state: 'clash', base: 'main', path: two, files: ['app.js'] });
  assert.match(readFileSync(join(two, 'app.js'), 'utf8'), /^<<<<<<< /m, 'left mid-merge for Tobin');
  // Tobin resolves it, keeping both sides' intent, and commits the merge.
  writeFileSync(join(two, 'app.js'), 'one\ntwo\n');
  execFileSync('git', ['add', 'app.js'], { cwd: two });
  execFileSync('git', [...T, 'commit', '-q', '--no-edit'], { cwd: two });
  assert.deepEqual(updateBranch(dir, 2), { state: 'current', base: 'main', path: two });
  const diff = execFileSync('git', ['diff', 'main...card-2'], { cwd: dir, encoding: 'utf8' });
  assert.doesNotMatch(diff, /^[+-]?(<<<<<<<|=======|>>>>>>>)/m, 'what Milo sees has no clash in it');
  assert.equal(mergeCard(dir, 2).into, 'main');
  assert.equal(readFileSync(join(dir, 'app.js'), 'utf8'), 'one\ntwo\n');
});

test('a clash called again reports the same files and starts no new merge (#267)', () => {
  const dir = onMain();
  const { path } = fleetBranch(dir, 1);
  commitIn(path, 'app.js', 'card\n');
  commitIn(dir, 'app.js', 'main\n');
  const first = updateBranch(dir, 1);
  assert.equal(first.state, 'clash');
  const head = execFileSync('git', ['rev-parse', 'MERGE_HEAD'], { cwd: path, encoding: 'utf8' });
  assert.deepEqual(updateBranch(dir, 1), first);
  assert.equal(execFileSync('git', ['rev-parse', 'MERGE_HEAD'], { cwd: path, encoding: 'utf8' }), head);
});

test('fleet update refuses a dirty copy, and a card with no branch (#267)', () => {
  const dir = onMain();
  const { path } = fleetBranch(dir, 1);
  writeFileSync(join(path, 'app.js'), 'half done\n');
  assert.throws(() => updateBranch(dir, 1), /uncommitted changes[\s\S]*app\.js/);
  assert.throws(() => updateBranch(dir, 2), /no branch card-2/);
});

test('soloagile fleet update prints the clash and exits 1, or up to date and exits 0 (#267)', () => {
  const dir = onMain();
  const { path } = fleetBranch(dir, 1);
  const run = () => spawnSync('node', [PM, 'fleet', 'update', '1'], { cwd: dir, encoding: 'utf8' });
  const current = run();
  assert.equal(current.status, 0, current.stderr);
  assert.match(current.stdout, /soloagile: card-1 is already up to date with main/);
  commitIn(dir, 'b.txt', 'b\n');
  const merged = run();
  assert.equal(merged.status, 0, merged.stderr);
  assert.match(merged.stdout, /soloagile: brought card-1 up to date with main; no clash/);
  commitIn(path, 'app.js', 'card\n');
  commitIn(dir, 'app.js', 'main\n');
  const clash = run();
  assert.equal(clash.status, 1);
  assert.match(clash.stdout, /soloagile: card-1 clashes with main in 1 file\(s\), left mid-merge in .*card-1 for Tobin:\n  app\.js\n/);
});

test('the fleet skill brings the branch up to date before the blind review, and Tobin resolves a clash (#267)', () => {
  const skill = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'fleet', 'SKILL.md'), 'utf8');
  const build = skill.indexOf('**3. Build');
  const update = skill.indexOf('soloagile fleet update <n>');
  const review = skill.indexOf('**4. Blind review');
  assert.ok(build > 0 && build < update && update < review, 'fleet update sits between Build and Blind review');
  const step = skill.slice(update, review).replace(/\n\s*/g, ' ');
  assert.match(step, /new Tobin/);
  assert.match(step, /resolve/);
  assert.match(step, /## Merge with main/);
  assert.match(skill.replace(/\n\s*/g, ' '), /after each rework round[^.]*step 3b/i);
});

// #267 round 1: the findings Orla upheld.
test('a card main has moved past is refused at merge until fleet update and a resolve (#267)', () => {
  const dir = onMain();
  const one = fleetBranch(dir, 1).path;
  const two = fleetBranch(dir, 2).path;
  commitIn(one, 'app.js', 'one\n');
  commitIn(two, 'app.js', 'two\n');
  // Both reviewed side by side against the old main.
  assert.equal(updateBranch(dir, 1).state, 'current');
  assert.equal(updateBranch(dir, 2).state, 'current');
  assert.equal(mergeCard(dir, 1).into, 'main');
  const before = execFileSync('git', ['rev-parse', 'main'], { cwd: dir, encoding: 'utf8' });
  assert.throws(() => mergeCard(dir, 2), /card-2 doesn't have main's latest[\s\S]*soloagile fleet update 2[\s\S]*review/);
  assert.equal(execFileSync('git', ['rev-parse', 'main'], { cwd: dir, encoding: 'utf8' }), before, 'nothing merged');
  assert.ok(branches(dir).includes('card-2'));
  assert.equal(updateBranch(dir, 2).state, 'clash');
  writeFileSync(join(two, 'app.js'), 'one\ntwo\n');
  execFileSync('git', ['add', 'app.js'], { cwd: two });
  execFileSync('git', [...T, 'commit', '-q', '--no-edit'], { cwd: two });
  assert.equal(mergeCard(dir, 2).into, 'main');
  assert.equal(readFileSync(join(dir, 'app.js'), 'utf8'), 'one\ntwo\n');
});

test('the skills send a refused merge back through fleet update, a resolving Tobin and review (#267)', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const fleet = readFileSync(join(root, 'skills', 'fleet', 'SKILL.md'), 'utf8').replace(/\n\s*/g, ' ');
  assert.match(fleet, /`soloagile fleet merge <n>`[^.]*refuses[^.]*Tobin[^.]*Milo/);
  const needs = readFileSync(join(root, 'skills', 'needs', 'SKILL.md'), 'utf8').replace(/\n\s*/g, ' ');
  assert.match(needs, /refused[^.]*`soloagile fleet update <number>`[^.]*Tobin[^.]*Milo/);
});

test('fleet update refuses a branch that still holds conflict markers (#267)', () => {
  const dir = onMain();
  const { path } = fleetBranch(dir, 1);
  commitIn(path, 'app.js', '<<<<<<< HEAD\none\n=======\ntwo\n>>>>>>> main\n');
  commitIn(path, 'ok.txt', 'fine\n');
  assert.throws(() => updateBranch(dir, 1), (e) => /conflict markers/.test(e.message) && /app\.js/.test(e.message) && !/ok\.txt/.test(e.message));
  commitIn(dir, 'b.txt', 'main moved\n');
  assert.throws(() => updateBranch(dir, 1), /conflict markers[\s\S]*app\.js/, 'after a clean merge too');
});

test('only a full set of markers in order counts, so a setext heading passes (#267)', () => {
  const dir = onMain();
  const { path } = fleetBranch(dir, 1);
  commitIn(path, 'README.md', 'Status\n=======\n\nAll good.\n');
  assert.equal(updateBranch(dir, 1).state, 'current');
  commitIn(path, 'notes.md', '>>>>>>> late\n=======\n<<<<<<< early\n');
  assert.equal(updateBranch(dir, 1).state, 'current', 'out of order is not a set');
  commitIn(path, 'README.md', 'Status\n=======\n<<<<<<< HEAD\none\n=======\ntwo\n>>>>>>> main\n');
  assert.throws(() => updateBranch(dir, 1), /conflict markers[\s\S]*README\.md/);
});

test('the marker check reads a non-ASCII name and skips a symlink or directory (#267)', () => {
  const dir = onMain();
  const { path } = fleetBranch(dir, 1);
  mkdirSync(join(path, 'sub'));
  commitIn(path, 'sub/a.txt', 'fine\n');
  symlinkSync('sub', join(path, 'link'));
  execFileSync('git', ['add', 'link'], { cwd: path });
  execFileSync('git', [...T, 'commit', '-qm', 'link'], { cwd: path });
  assert.equal(updateBranch(dir, 1).state, 'current', 'a symlink to a directory is not read');
  commitIn(path, 'café.js', '<<<<<<< HEAD\none\n=======\ntwo\n>>>>>>> main\n');
  assert.throws(() => updateBranch(dir, 1), /conflict markers[\s\S]*café\.js/);
});

test('a merge resolved but not committed says to commit it, and the CLI exits 1 (#267)', () => {
  const dir = onMain();
  const { path } = fleetBranch(dir, 1);
  commitIn(path, 'app.js', 'card\n');
  commitIn(dir, 'app.js', 'main\n');
  assert.equal(updateBranch(dir, 1).state, 'clash');
  writeFileSync(join(path, 'app.js'), 'card\nmain\n');
  execFileSync('git', ['add', 'app.js'], { cwd: path });
  const r = updateBranch(dir, 1);
  assert.deepEqual(r, { state: 'resolved', base: 'main', path });
  assert.match(updateText(1, r), /commit the merge/);
  const cli = spawnSync('node', [PM, 'fleet', 'update', '1'], { cwd: dir, encoding: 'utf8' });
  assert.equal(cli.status, 1, cli.stderr);
  assert.match(cli.stdout, /commit the merge/);
});

test('fleet update on a detached main tree says it is not on a branch (#267)', () => {
  const dir = onMain();
  fleetBranch(dir, 1);
  execFileSync('git', ['checkout', '-q', '--detach'], { cwd: dir });
  assert.throws(() => updateBranch(dir, 1), /the main tree isn't on a branch/);
});

test("fleet update gives the copy's path in every state, and the text uses it (#267)", () => {
  const dir = onMain();
  const { path } = fleetBranch(dir, 1);
  assert.equal(updateBranch(dir, 1).path, path);
  commitIn(dir, 'b.txt', 'b\n');
  assert.equal(updateBranch(dir, 1).path, path);
  commitIn(path, 'app.js', 'card\n');
  commitIn(dir, 'app.js', 'main\n');
  const clash = updateBranch(dir, 1);
  assert.equal(clash.path, path);
  assert.match(updateText(1, { ...clash, path: '/somewhere/else' }), /left mid-merge in \/somewhere\/else for Tobin/);
});
