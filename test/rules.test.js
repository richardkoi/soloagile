import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';
import { addRule } from '../src/rules.js';

const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'soloagile');

test('a rule is numbered on in a Standing rules section, tagged with where it came from', () => {
  const first = addRule('# Alpha\n\nSome notes.\n', 'Check new charts on a busy board.', 'retro of M14, #129');
  assert.equal(first.number, 1);
  assert.equal(first.md, '# Alpha\n\nSome notes.\n\n## Standing rules\n\nLessons from retros, kept by `soloagile rule`. Each says where it came from.\n\n1. Check new charts on a busy board. (From retro of M14, #129.)\n');
  const second = addRule(first.md.replace('\n$', '') + '\n## Commands\n\nnpm test\n', 'Two tries, then show the user.', 'retro of M15');
  assert.equal(second.number, 2);
  assert.match(second.md, /1\. Check new charts.*\n2\. Two tries, then show the user\. \(From retro of M15\.\)\n\n## Commands/);
  assert.equal(addRule(second.md, 'Two tries, then show the user.', 'again').number, null, 'not added twice');
  assert.throws(() => addRule('', '  ', null), /a rule needs its words/);
});

test('soloagile rule writes CLAUDE.md, unless the retro-rules habit is off', () => {
  const repo = mkdtempSync(join(tmpdir(), 'soloagile-rules-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), '# Board\n');
  const run = (...a) => spawnSync(PM, ['rule', ...a], { cwd: repo, encoding: 'utf8' });
  const r = run('Ask before a deploy.', '--from', 'retro of M2, #5');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /standing rule 1 in .*CLAUDE\.md/);
  assert.match(readFileSync(join(repo, 'CLAUDE.md'), 'utf8'), /^1\. Ask before a deploy\. \(From retro of M2, #5\.\)$/m);
  spawnSync(PM, ['set', 'retro-rules', 'off'], { cwd: repo });
  assert.match(run('Another.').stdout, /retro-rules habit is off/);
  assert.doesNotMatch(readFileSync(join(repo, 'CLAUDE.md'), 'utf8'), /Another/);
});

test('a project that keeps its CLAUDE.md in .claude/ gets its rules there', () => {
  const repo = mkdtempSync(join(tmpdir(), 'soloagile-rules-'));
  mkdirSync(join(repo, 'pm'));
  mkdirSync(join(repo, '.claude'));
  writeFileSync(join(repo, 'pm', 'board.md'), '# Board\n');
  writeFileSync(join(repo, '.claude', 'CLAUDE.md'), '# Notes\n');
  const r = spawnSync(PM, ['rule', 'Ask before a deploy.'], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(repo, '.claude', 'CLAUDE.md'), 'utf8'), /^1\. Ask before a deploy\.$/m);
  assert.ok(!existsSync(join(repo, 'CLAUDE.md')), 'no second CLAUDE.md at the root');
});

test('soloagile rule --remove takes a rule out and renumbers the rest, leaving other lists alone (#182)', async () => {
  const { removeRule } = await import('../src/rules.js');
  const md = '# A\n\n## Standing rules\n\nIntro.\n\n1. One. (From x.)\n2. Two. (From y.)\n3. Three.\n4. Four.\n\n## Steps\n\n1. Keep me.\n2. And me.\n';
  const { md: out, removed } = removeRule(md, 2);
  assert.equal(removed, '2. Two. (From y.)');
  assert.equal(out, '# A\n\n## Standing rules\n\nIntro.\n\n1. One. (From x.)\n2. Three.\n3. Four.\n\n## Steps\n\n1. Keep me.\n2. And me.\n');
  assert.throws(() => removeRule(md, 9), /no standing rule 9/);
  assert.throws(() => removeRule('# A\n', 1), /no standing rule 1/);

  const repo = mkdtempSync(join(tmpdir(), 'soloagile-rules-'));
  writeFileSync(join(repo, 'CLAUDE.md'), md);
  const r = spawnSync(PM, ['rule', '--remove', '3'], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /removed from .*CLAUDE\.md: 3\. Three\./);
  assert.match(readFileSync(join(repo, 'CLAUDE.md'), 'utf8'), /2\. Two\. \(From y\.\)\n3\. Four\.\n/);
  assert.equal(spawnSync(PM, ['rule', '--remove', '7'], { cwd: repo, encoding: 'utf8' }).status, 2);
});
