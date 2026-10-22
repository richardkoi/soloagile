import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const json = (...path) => JSON.parse(readFileSync(join(ROOT, ...path), 'utf8'));

test('the three hooks ship in the plugin, and run its own command', () => {
  const { hooks } = json('hooks', 'hooks.json');
  assert.deepEqual(Object.keys(hooks).sort(), ['PostToolUse', 'SessionEnd', 'SessionStart']);
  const run = { PostToolUse: 'hook', SessionStart: 'session-start', SessionEnd: 'session-end' };
  for (const [event, [entry]] of Object.entries(hooks)) {
    assert.equal(entry.hooks[0].command, `"\${CLAUDE_PLUGIN_ROOT}"/bin/soloagile ${run[event]}`);
  }
  assert.match(hooks.SessionStart[0].matcher, /compact/, 'the rules are given again after a compaction, which would drop them');
});

test('saving at session end is an install option, off unless chosen', () => {
  const option = json('.claude-plugin', 'plugin.json').userConfig.save_at_session_end;
  assert.equal(option.type, 'boolean');
  assert.equal(option.default, false);
});

test('no CLAUDE.md at the plugin root: Claude Code would not load it, so the rules are in rules.md', () => {
  assert.ok(!existsSync(join(ROOT, 'CLAUDE.md')));
  assert.match(readFileSync(join(ROOT, 'rules.md'), 'utf8'), /^# soloagile rules/);
});

test('the rules and the spec carry the three lessons from the first retro', () => {
  for (const file of ['rules.md', 'SPEC.md']) {
    const text = readFileSync(join(ROOT, file), 'utf8').replace(/\s+/g, ' ');
    assert.match(text, /fact from docs[^.]*(try|tries) it for real/i, `${file}: try a docs fact before planning on it`);
    assert.match(text, /special set-up[^.]*first card/i, `${file}: set up the clean test first`);
    assert.match(text, /departs from the option the user picked[^.]*at once/i, `${file}: say at once when a build departs`);
  }
});

test('the rules and the spec carry the lessons from the M9, M15 and M17 retros', () => {
  for (const file of ['rules.md', 'SPEC.md']) {
    const text = readFileSync(join(ROOT, file), 'utf8').replace(/\s+/g, ' ');
    assert.match(text, /after a milestone's work is done[^.]*new milestone/i, `${file}: late cards get a new milestone (#162)`);
    assert.match(text, /phone[^.]*before[^.]*Needs your look/i, `${file}: phone shots come before the look (#163)`);
    assert.match(text, /only projects on this machine/i, `${file}: a done when names only projects here (#165)`);
    assert.doesNotMatch(text, /3dweather/, `${file}: 3dweather isn't on this machine (#165)`);
  }
});

test('the rules and the spec keep board upkeep cheap (M20)', () => {
  for (const file of ['rules.md', 'SPEC.md']) {
    const text = readFileSync(join(ROOT, file), 'utf8').replace(/\s+/g, ' ');
    assert.match(text, /card commands[^.]*same turn as[^.]*other work/i, `${file}: card commands ride along with real work (#176)`);
    assert.match(text, /never a turn of their own/i, `${file}: no turn just for the board (#176)`);
    assert.match(text, /card note is one short line[^.]*100 characters[^.]*commit message/i, `${file}: short card notes (#178)`);
  }
});
