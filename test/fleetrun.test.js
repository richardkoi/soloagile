// soloagile fleet run <n> (#299): the card's fleet in its own claude -p session, a short
// summary back. A stand-in claude records what it was given and writes what a run would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';
import { finalMessage, summary } from '../src/fleetrun.js';

const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'soloagile');

// A project folder, and a fake claude that writes report.md (when given one) and prints
// stream-json lines ending in a result, then exits with `code`.
const setup = ({ report = null, text = 'All done.', code = 0, plain = null } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'fleetrun-'));
  mkdirSync(join(dir, 'pm'));
  const bin = mkdtempSync(join(tmpdir(), 'fake-claude-'));
  if (report !== null) writeFileSync(join(bin, 'report'), report);
  writeFileSync(join(bin, 'out'), plain ?? [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    JSON.stringify({ type: 'result', subtype: 'success', result: text }),
  ].join('\n') + '\n');
  writeFileSync(join(bin, 'claude'), `#!/bin/sh
out="${bin}"
pwd > "$out/cwd"
printf '%s' "$SOLOAGILE_FLEET_INNER" > "$out/inner"
for a in "$@"; do printf '%s\\n--ARG--\\n' "$a"; done > "$out/args"
if [ -f "$out/report" ]; then mkdir -p pm/runs/7 && cp "$out/report" pm/runs/7/report.md; fi
cat "$out/out"
echo "a line on stderr" >&2
exit ${code}
`);
  chmodSync(join(bin, 'claude'), 0o755);
  const run = (...extra) => spawnSync('node', [PM, 'fleet', 'run', '7', ...extra], { cwd: dir, encoding: 'utf8', env: { ...process.env, SOLOAGILE_CLAUDE: join(bin, 'claude'), SOLOAGILE_FLEET_INNER: '' } });
  return { dir, bin, run, read: (n) => readFileSync(join(bin, n), 'utf8') };
};
const argsOf = (raw) => raw.split('\n--ARG--\n').slice(0, -1);
const REPORT = Array.from({ length: 40 }, (_, i) => `- line ${i + 1}`).join('\n');

test('fleet run starts claude -p with the fleet skill in the project, auto permissions and the inner flag (#299)', () => {
  const f = setup({ report: '- done when: x · pass\n' });
  const r = f.run();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(argsOf(f.read('args')), ['-p', '/soloagile:fleet 7', '--permission-mode', 'auto', '--output-format', 'stream-json', '--verbose']);
  assert.equal(f.read('cwd').trim(), f.dir);
  assert.equal(f.read('inner'), '1', 'SOLOAGILE_FLEET_INNER=1 reaches the inner session');
  assert.ok(!argsOf(f.read('args')).some((a) => /bypass|dangerously/i.test(a)), 'never bypasses permissions');
});

test('fleet run --root runs in another project, and --permission-mode chooses the mode (#299)', () => {
  const f = setup({ report: '- ok\n' });
  const elsewhere = mkdtempSync(join(tmpdir(), 'elsewhere-'));
  const r = spawnSync('node', [PM, 'fleet', 'run', '7', '--root', f.dir, '--permission-mode', 'acceptEdits'], { cwd: elsewhere, encoding: 'utf8', env: { ...process.env, SOLOAGILE_CLAUDE: join(f.bin, 'claude') } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(f.read('cwd').trim(), f.dir);
  const args = argsOf(f.read('args'));
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'acceptEdits');
  assert.ok(existsSync(join(f.dir, 'pm', 'runs', '7', 'session.log')));
});

test("fleet run writes the session's whole output, stderr too, to pm/runs/<n>/session.log (#299)", () => {
  const f = setup({ report: '- ok\n', text: 'THE END' });
  f.run();
  const log = readFileSync(join(f.dir, 'pm', 'runs', '7', 'session.log'), 'utf8');
  assert.match(log, /"type":"system"/);
  assert.match(log, /"result":"THE END"/);
  assert.match(log, /a line on stderr/);
});

test("fleet run's summary is the head of report.md and where things are, 20 lines at most (#299)", () => {
  const f = setup({ report: REPORT, text: Array.from({ length: 50 }, (_, i) => `msg ${i}`).join('\n') });
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trimEnd().split('\n');
  assert.ok(lines.length <= 20, `${lines.length} lines`);
  assert.match(lines[0], /#7's fleet run ended; its report:/);
  assert.equal(lines[1], '- line 1');
  assert.ok(!r.stdout.includes('- line 40'), 'cut to the head');
  assert.ok(!r.stdout.includes('msg '), 'the report, not the message');
  assert.match(lines.at(-1), /branch: card-7 · report: pm\/runs\/7\/report\.md · log: pm\/runs\/7\/session\.log/);
});

test('fleet run exits 1 when it leaves no report, and gives the end of the last message, capped (#299)', () => {
  const f = setup({ text: Array.from({ length: 50 }, (_, i) => `msg ${i}`).join('\n') });
  const r = f.run();
  assert.equal(r.status, 1);
  const lines = r.stdout.trimEnd().split('\n');
  assert.ok(lines.length <= 20, `${lines.length} lines`);
  assert.match(lines[0], /left no report \(exit 0\)/);
  assert.ok(r.stdout.includes('msg 49') && !r.stdout.includes('msg 10\n'), 'the last lines');
});

test('fleet run exits 1 when the inner run fails, even with a report (#299)', () => {
  const f = setup({ report: '- half\n', code: 3 });
  const r = f.run();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /failed \(exit 3\); its report:/);
});

test("an old report.md from before the run doesn't count as this run's (#299)", () => {
  const f = setup({ text: 'stopped on a choice' });
  mkdirSync(join(f.dir, 'pm', 'runs', '7'), { recursive: true });
  const old = join(f.dir, 'pm', 'runs', '7', 'report.md');
  writeFileSync(old, '- old\n');
  utimesSync(old, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
  const r = f.run();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /stopped on a choice/);
});

test('fleet run says so when claude cannot start (#299)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fleetrun-'));
  const r = spawnSync('node', [PM, 'fleet', 'run', '7'], { cwd: dir, encoding: 'utf8', env: { ...process.env, SOLOAGILE_CLAUDE: join(dir, 'no-such-claude') } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /didn't start/);
});

test('finalMessage takes the last result line, or the plain text; summary caps any input at 20 lines (#299)', () => {
  assert.equal(finalMessage('{"type":"result","result":"a"}\n{"type":"result","result":"b"}\n'), 'b');
  assert.equal(finalMessage('plain words\n'), 'plain words');
  const many = Array.from({ length: 100 }, (_, i) => `x${i}`).join('\n');
  for (const s of [summary(1, { report: many, status: 0, log: 'l' }), summary(1, { report: null, message: many, status: 1, log: 'l' })]) {
    assert.ok(s.split('\n').length <= 20);
  }
});
