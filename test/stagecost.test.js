import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';
import { minute } from '../src/history.js';
import { cardWindow, stageCosts, stageText } from '../src/stagecost.js';
import { projectSlug } from '../src/tokens.js';

const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'soloagile');
const T0 = Date.parse('2026-11-18T10:00:00Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();

// One assistant line: usage { input, writes, reads, output } at minute min of the run
let n = 0;
const line = (min, [input, writes, reads, output]) => JSON.stringify({
  type: 'assistant', timestamp: at(min), requestId: `r${n}`,
  message: { id: `m${n++}`, usage: { input_tokens: input, cache_creation_input_tokens: writes, cache_read_input_tokens: reads, output_tokens: output } },
});
const write = (path, lines) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${lines.join('\n')}\n`); };
const helper = (dir, session, agent, meta, lines) => {
  write(join(dir, session, 'subagents', `agent-${agent}.jsonl`), lines);
  writeFileSync(join(dir, session, 'subagents', `agent-${agent}.meta.json`), JSON.stringify(meta));
};

// A project whose card 5 ran from minute 0 to minute 60, driven from another project's
// session, beside card 6 running at the same time, and an unrelated session of its own.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'stage-'));
  const projects = mkdtempSync(join(tmpdir(), 'logs-'));
  mkdirSync(join(root, 'pm', 'runs', '5'), { recursive: true });
  writeFileSync(join(root, 'pm', 'runs', '5', 'usage-start.json'), JSON.stringify({ at: at(0), pcts: { week: 1 } }));
  writeFileSync(join(root, 'pm', 'history.md'), `# History\n\n- ${minute(new Date(T0))} · Doing · #5 Five · M1 · 2 pts\n- ${minute(new Date(T0 + 60 * 60000))} · Needs your look · #5 Five · M1 · 2 pts\n`);
  const own = join(projects, projectSlug(root));
  const other = join(projects, '-somewhere-else');
  // the driver, in another project: its lines in the window count, the one after doesn't
  write(join(other, 'drv.jsonl'), [line(1, [1, 10, 100, 1000]), line(30, [1, 10, 100, 1000]), line(200, [9, 9, 9, 9])]);
  helper(other, 'drv', 'a', { agentType: 'soloagile:tobin', description: 'Tobin builds #5' }, [line(5, [2, 20, 200, 2000]), line(25, [2, 20, 200, 2000])]);
  helper(other, 'drv', 'b', { agentType: 'soloagile:milo', description: 'Milo blind-reviews #5' }, [line(40, [3, 30, 300, 3000])]);
  helper(other, 'drv', 'c', { agentType: 'soloagile:cora', description: 'Cora designs card 5' }, [line(2, [4, 0, 0, 4]), line(12, [4, 0, 0, 4])]);
  // card 6's Tobin, at the same time: not card 5's
  helper(other, 'drv6', 'd', { agentType: 'soloagile:tobin', description: 'Tobin builds #6' }, [line(10, [50, 50, 50, 50])]);
  write(join(other, 'drv6.jsonl'), [line(10, [70, 70, 70, 70])]);
  // a general helper naming #5 is no stage; an own session is no driver once one is found
  helper(other, 'drv', 'e', { agentType: 'general-purpose', description: 'Look at #5' }, [line(10, [60, 60, 60, 60])]);
  write(join(own, 'mine.jsonl'), [line(10, [80, 80, 80, 80])]);
  // a Rufus with no card named, in the project's own logs, counts
  helper(own, 'mine', 'f', { agentType: 'soloagile:rufus', description: 'Rufus lists the security lines' }, [line(50, [5, 5, 5, 5])]);
  return { root, projects };
}

const byStage = (rows) => Object.fromEntries(rows.map((r) => [r.stage, r]));

test("each helper's tokens go to its stage, and only the card's own helpers count (#297)", () => {
  const { root, projects } = fixture();
  const w = cardWindow(root, 5);
  const rows = byStage(stageCosts(root, 5, w.from, w.to, { projectsDir: projects }));
  assert.deepEqual(Object.keys(rows), ['main session', 'Tobin', 'Milo', 'Cora', 'Rufus']);
  const counts = (r) => [r.input_tokens, r.cache_creation_input_tokens, r.cache_read_input_tokens, r.output_tokens];
  assert.deepEqual(counts(rows['main session']), [2, 20, 200, 2000], "the driver's two lines in the window, not card 6's or the own session's");
  assert.deepEqual(counts(rows.Tobin), [4, 40, 400, 4000], "card 6's Tobin is left out");
  assert.deepEqual(counts(rows.Milo), [3, 30, 300, 3000]);
  assert.deepEqual(counts(rows.Cora), [8, 0, 0, 8], '"card 5" names the card too');
  assert.deepEqual(counts(rows.Rufus), [5, 5, 5, 5]);
});

test("a card with no helper naming it takes the project's own sessions as its main session (#297)", () => {
  const { root, projects } = fixture();
  const w = cardWindow(root, 5);
  const rows = byStage(stageCosts(root, 7, w.from, w.to, { projectsDir: projects }));
  assert.equal(rows['main session'].input_tokens, 80);
  assert.equal(rows.Tobin.input_tokens, 0);
});

test('the window runs from the Doing start to the end of the look minute, or to now while in Doing (#297)', () => {
  const { root } = fixture();
  assert.deepEqual(cardWindow(root, 5), { from: T0, to: T0 + 60 * 60000 + 59999, open: false });
  // no usage-start.json: the first Doing line in history.md, and still in Doing
  writeFileSync(join(root, 'pm', 'history.md'), `# History\n\n- ${minute(new Date(T0 + 5 * 60000))} · Doing · #8 Eight · M1 · 1 pt\n`);
  const now = new Date(T0 + 90 * 60000);
  assert.deepEqual(cardWindow(root, 8, { now }), { from: T0 + 5 * 60000, to: now.getTime(), open: true });
  assert.equal(cardWindow(root, 9), null, 'a card that never went into Doing has no window');
});

test("minutes are each file's first to last message in the window, summed over the stage (#297)", () => {
  const { root, projects } = fixture();
  const w = cardWindow(root, 5);
  const rows = byStage(stageCosts(root, 5, w.from, w.to, { projectsDir: projects }));
  assert.equal(rows['main session'].minutes, 29, "the line at minute 200 is outside");
  assert.equal(rows.Tobin.minutes, 20);
  assert.equal(rows.Milo.minutes, 0, 'one message is no span');
  assert.equal(rows.Cora.minutes, 10);
});

test('the table has a row per stage and a total, tokens written like formatTokens (#297)', () => {
  const rows = [
    { stage: 'main session', input_tokens: 324, cache_creation_input_tokens: 202000, cache_read_input_tokens: 32e6, output_tokens: 95000, minutes: 85.2 },
    { stage: 'Tobin', input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 5.7e6, output_tokens: 0, minutes: 57 },
  ];
  const text = stageText(5, { from: T0, to: T0 + 3600000, open: false }, rows);
  assert.match(text, /^## By stage\n#5 from /);
  assert.match(text, /Stage +Input +Cache writes +Cache reads +Output +Total +Minutes/);
  assert.match(text, /main session +324 +202k +32M +95k +32M +85\n/);
  assert.match(text, /total +324 +202k +38M +95k +38M +142\n/);
  assert.match(text, /fleet milo\) keep no log/);
  assert.match(stageText(5, { from: T0, to: T0, open: true }, rows), /to now \(still in Doing\)/);
  assert.match(stageText(5, null, []), /never went into Doing/);
});

test('soloagile fleet cost <n> --root prints the ## Cost and the stage table (#297)', () => {
  const { root, projects } = fixture();
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  const env = { ...process.env, HOME: home, SOLOAGILE_DIR: home, SOLOAGILE_CLAUDE_PROJECTS: projects };
  const r = spawnSync('node', [PM, 'fleet', 'cost', '5', '--root', root], { cwd: tmpdir(), encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^## Cost\n/);
  assert.match(r.stdout, /## By stage\n#5 from /);
  assert.match(r.stdout, /\nTobin +4 +40 +400 +4k +4.4k +20\n/);
  assert.match(r.stdout, /\ntotal +22 +95 +905 +9k +10k +59\n/);
  const bad = spawnSync('node', [PM, 'fleet', 'cost', '5', '--root'], { cwd: root, encoding: 'utf8', env });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--root needs a folder/);
});
