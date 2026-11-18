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
import { cardBase, cardDiff, dropRun, fleetBranch, mergeCard, preflight, runDir, runPageHtml, scanDiff, sendBack, unlock } from '../src/fleet.js';

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

// #269: the words that tripped the scan on #259, #260, #265 and #266, none of them in code.
const added = (file, ...lines) => `--- a/${file}\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}\n`;

test('session is not a login word; cookie still is (#260)', () => {
  assert.deepEqual(scanDiff(added('test/refresh.test.js', "  assert.equal(seen.flow.title, 'Session flow - PM');")), []);
  assert.equal(scanDiff(added('src/a.js', 'const cookie = req.headers.cookie;'))[0]?.why, 'a login or password');
});

test('the scan skips comments but keeps the code before a trailing comment and URLs (#259, #260)', () => {
  assert.deepEqual(scanDiff(added('template/guide.html', '<!-- The command guide: one list, in the order of a session. It is a modal <dialog> opened -->')), []);
  assert.deepEqual(scanDiff(added('template/guide.html', '<!-- The command guide: one list, in the order of a session.', 'It is a modal <dialog> opened from the token button', '-->', '<p>a session cookie</p>')).map((h) => h.line), [4], 'a comment over lines is skipped, the line after is not');
  // The comment opened in a context line, before the hunk's added lines.
  assert.deepEqual(scanDiff('--- a/t.html\n+++ b/t.html\n@@ -1,2 +1,3 @@\n <!-- the guide\n+opened from the token button\n -->\n'), []);
  assert.deepEqual(scanDiff(added('template/refresh.js', '  // the "Session flow" tab, and its auth cookie', '  /* the token', '   * and the password */')), []);
  assert.deepEqual(scanDiff(added('deploy.sh', '  # read the api_key from vault')), []);
  assert.deepEqual(scanDiff(added('config.yml', '# the token lives elsewhere', 'name: app # no password here')), []);
  assert.equal(scanDiff(added('deploy.sh', '#!/bin/sh token'))[0]?.why, 'a key or token', 'a shebang is not a comment');
  assert.equal(scanDiff(added('src/a.js', '# a token'))[0]?.why, 'a key or token', '# is a comment only in the # languages');
  assert.equal(scanDiff(added('src/a.js', 'const api_key = x; // note'))[0]?.why, 'a key or token');
  assert.deepEqual(scanDiff(added('src/a.js', 'const x = 1; // the token')), []);
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
  assert.deepEqual(scanDiff(added('bin/tool', '#!/bin/sh', 'echo hi # the token')), []);
  assert.deepEqual(scanDiff(added('Dockerfile', '# the token comes later')), []);
});

// A file on main whose fence and shebang sit far above the card's change.
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
  writeFileSync(join(path, 'bin', 'tool'), readFileSync(join(path, 'bin', 'tool'), 'utf8') + 'console.log(`card #${id}`, process.env.X)\n');
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
