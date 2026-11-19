import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';
import { logCost } from '../src/costs.js';

const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'soloagile');
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'costs-'));
  mkdirSync(join(dir, 'pm'));
  writeFileSync(join(dir, 'pm', 'board.md'), `# Board
<!-- next-id: 4 -->

## Ideas

## Up next
- #3 Third · M1 · 1 pt
  done when: it works

## Doing
- #1 Fleet card · M1 · 2 pts · fleet · develop
  done when: it parses
- #2 Normal card · M1 · 2 pts · develop
  done when: it shows

## Needs your look

## Needs your decision

## Done
`);
  writeFileSync(join(dir, 'pm', 'plan.md'), '# Plan\n\n## M1 · First · in progress\nshort: first\nCards: #1, #2, #3\n');
  return dir;
};
const start = (dir, id, pcts) => {
  mkdirSync(join(dir, 'pm', 'runs', String(id)), { recursive: true });
  writeFileSync(join(dir, 'pm', 'runs', String(id), 'usage-start.json'), JSON.stringify({ at: '2026-11-18T10:00:00Z', pcts }));
};

test('a fleet run and a normal build of the same size sit side by side in pm/runs/costs.md (#280)', () => {
  const dir = project();
  start(dir, 1, { week: 8, '5 hours': 11 });
  mkdirSync(join(dir, 'pm', 'runs', '1'), { recursive: true });
  writeFileSync(join(dir, 'pm', 'runs', '1', 'plan.md'), '# Plan\n');
  start(dir, 2, { week: 9, '5 hours': 20 });
  const now = new Date('2026-11-18T11:00:00Z');
  assert.equal(logCost(dir, 1, { pcts: { week: 9, '5 hours': 14 } }, { now }), true);
  assert.equal(logCost(dir, 2, { pcts: { week: 9, '5 hours': 21 } }, { now }), true);
  const md = readFileSync(join(dir, 'pm', 'runs', 'costs.md'), 'utf8');
  assert.match(md, /\| #1 \| 2 \| fleet \| 1\.0% \| 3\.0% \| 2026-11-18 \|/);
  assert.match(md, /\| #2 \| 2 \| normal \| 0\.0% \| 1\.0% \| 2026-11-18 \|/);
  assert.match(md, /\| 2 \| 1 run, 3\.0% of the 5 hours \| 1 build, 1\.0% of the 5 hours \|/, 'the by-size table sets them side by side');
  assert.equal(logCost(dir, 1, { pcts: { week: 9, '5 hours': 15 } }, { now }), true, 'a card logged again replaces its row');
  assert.equal(readFileSync(join(dir, 'pm', 'runs', 'costs.md'), 'utf8').match(/\| #1 \|/g).length, 1);
  assert.equal(logCost(dir, 3, { pcts: { week: 9 } }, { now }), false, 'no start reading, no row');
  assert.equal(logCost(dir, 2, { said: 'no usage address set' }, { now }), false, 'no end numbers, no row');
});

test('card move to doing records the start reading, and to look logs the cost (#280)', () => {
  const dir = project();
  const move = (...a) => spawnSync('node', [PM, 'card', 'move', ...a], { cwd: dir, encoding: 'utf8' });
  assert.equal(move('3', 'doing', 'develop').status, 0);
  assert.ok(existsSync(join(dir, 'pm', 'runs', '3', 'usage-start.json')), 'the start is recorded, even with no usage address');
  spawnSync('node', [PM, 'card', 'note', '3', 'tested: by hand'], { cwd: dir });
  const r = move('3', 'look');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(dir, 'pm', 'runs', 'costs.md')), 'with no numbers nothing is logged');
});
