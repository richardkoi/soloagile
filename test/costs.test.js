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
  assert.match(md, /\| #1 \| 2 \| fleet \| 1\.0% \| 3\.0% \| – \| 2026-11-18 \|/);
  assert.match(md, /\| #2 \| 2 \| normal \| 0\.0% \| 1\.0% \| – \| 2026-11-18 \|/);
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

// #286: the percentages are whole at the source, so a short build reads 0 or 1%. The tokens
// come from Claude Code's own logs for the project (and its fleet copies), counted between
// the card's move to Doing and now, each message once, as TokenSentinel and ccusage count.
import { formatTokens, projectTokens, projectSlug } from '../src/tokens.js';

const logLine = (at, id, usage, extra = {}) => JSON.stringify({ type: 'assistant', timestamp: at, requestId: `r-${id}`, message: { id, usage }, ...extra });
const logs = (dir) => {
  const base = mkdtempSync(join(tmpdir(), 'claude-projects-'));
  const main = join(base, projectSlug(dir));
  const copy = join(base, `${projectSlug(dir)}--claude-worktrees-card-1`);
  const other = join(base, `${projectSlug(dir)}-other`);
  for (const d of [main, join(main, 's1', 'subagents'), copy, other]) mkdirSync(d, { recursive: true });
  const u = (n) => ({ input_tokens: n, output_tokens: n, cache_creation_input_tokens: n, cache_read_input_tokens: n });
  writeFileSync(join(main, 's1.jsonl'), [
    logLine('2026-11-18T09:59:00Z', 'm0', u(1000)), // before the card started
    logLine('2026-11-18T10:05:00Z', 'm1', u(10)), // streamed partial…
    logLine('2026-11-18T10:05:01Z', 'm1', u(100)), // …and its final line: counted once, the last
    JSON.stringify({ type: 'user', timestamp: '2026-11-18T10:06:00Z', message: { content: 'hi' } }),
    'not json',
    logLine('2026-11-18T11:30:00Z', 'm9', u(1000)), // after now
  ].join('\n'));
  writeFileSync(join(main, 's1', 'subagents', 'a.jsonl'), logLine('2026-11-18T10:10:00Z', 'm2', u(50)));
  writeFileSync(join(copy, 's2.jsonl'), logLine('2026-11-18T10:20:00Z', 'm3', u(25)));
  writeFileSync(join(other, 's3.jsonl'), logLine('2026-11-18T10:20:00Z', 'm4', u(7000))); // another project
  return base;
};

test("a card's tokens are the project's and its fleet copies' log lines inside its time, each message once (#286)", () => {
  const dir = project();
  const projectsDir = logs(dir);
  const n = projectTokens(dir, Date.parse('2026-11-18T10:00:00Z'), Date.parse('2026-11-18T11:00:00Z'), { projectsDir });
  assert.equal(n, 4 * (100 + 50 + 25));
  assert.equal(projectTokens(dir, 0, 1, { projectsDir: join(projectsDir, 'none') }), null, 'no logs folder: not measured');
  assert.equal(projectSlug('/mnt/data/apps/projects/soloagile'), '-mnt-data-apps-projects-soloagile');
  assert.deepEqual([12, 1234, 56789, 1234567, 2.5e9].map(formatTokens), ['12', '1.2k', '57k', '1.2M', '2.5B']);
});

test("costs.md gives each card its tokens beside the percentages, and the by-size table their average (#286)", () => {
  const dir = project();
  const projectsDir = logs(dir);
  start(dir, 1, { week: 8, '5 hours': 11 });
  writeFileSync(join(dir, 'pm', 'runs', '1', 'plan.md'), '# Plan\n');
  const now = new Date('2026-11-18T11:00:00Z');
  assert.equal(logCost(dir, 1, { pcts: { week: 8, '5 hours': 11 } }, { now, projectsDir }), true);
  const md = readFileSync(join(dir, 'pm', 'runs', 'costs.md'), 'utf8');
  assert.match(md, /\| Card \| Points \| How \| Week \| 5 hours \| Tokens \| Date \|/);
  assert.match(md, /\| #1 \| 2 \| fleet \| 0\.0% \| 0\.0% \| 700 \| 2026-11-18 \|/, 'a 0% card still reads its tokens');
  assert.match(md, /\| 2 \| 1 run, 0\.0% of the 5 hours, 700 tokens \| none yet \|/);
});

test("an old costs.md row with no tokens keeps its place and reads – (#286)", () => {
  const dir = project();
  mkdirSync(join(dir, 'pm', 'runs'), { recursive: true });
  writeFileSync(join(dir, 'pm', 'runs', 'costs.md'), '| Card | Points | How | Week | 5 hours | Date |\n|---|---|---|---|---|---|\n| #3 | 1 | normal | 1.0% | 4.0% | 2026-11-17 |\n');
  start(dir, 2, { week: 9, '5 hours': 20 });
  assert.equal(logCost(dir, 2, { pcts: { week: 9, '5 hours': 21 } }, { now: new Date('2026-11-18T11:00:00Z'), projectsDir: join(dir, 'none') }), true);
  const md = readFileSync(join(dir, 'pm', 'runs', 'costs.md'), 'utf8');
  assert.match(md, /\| #3 \| 1 \| normal \| 1\.0% \| 4\.0% \| – \| 2026-11-17 \|/);
  assert.match(md, /\| #2 \| 2 \| normal \| 0\.0% \| 1\.0% \| – \| 2026-11-18 \|/);
});
