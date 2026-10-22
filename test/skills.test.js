import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const read = (name) => readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8');

test('the plugin has its eight skills, each named after its folder', () => {
  assert.deepEqual(readdirSync(SKILLS).sort(), ['away', 'catchup', 'commit', 'init', 'needs', 'parallel', 'retro', 'save']);
  for (const name of readdirSync(SKILLS)) {
    const [, front] = read(name).match(/^---\n([\s\S]*?)\n---\n/) ?? [];
    assert.ok(front, `${name} has frontmatter`);
    assert.match(front, new RegExp(`^name: ${name}$`, 'm'));
    assert.match(front, /^description: .{40,}$/m, `${name} says when to use it`);
  }
});

test('a skill reaches the plugin by its own folder, never a path on one machine', () => {
  for (const name of readdirSync(SKILLS)) {
    const text = read(name);
    // A command run while the skill loads isn't on Claude's PATH, so it is called by its full path.
    for (const [, run] of text.matchAll(/!`([^`]*soloagile[^`]*)`/g)) assert.match(run, /^"\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/soloagile" /, `${name}: ${run}`);
    assert.doesNotMatch(text, /(^|[\s`(])\/(home|mnt|Users)\//, `${name} names a path on one machine`);
    assert.doesNotMatch(text, /`\/(catchup|commit|save|needs|retro|pm-init)`/, `${name} names a command without the plugin's name`);
  }
});

// A command run while a skill loads is refused unless the skill's allowed-tools covers every
// part of it, and a new user has nothing else allowed. Found by the stranger test (#84).
test("every command a skill runs as it loads is in the skill's own allowed-tools", () => {
  for (const name of readdirSync(SKILLS)) {
    const text = read(name);
    const allowed = [...text.match(/^allowed-tools: (.*)$/m)[1].matchAll(/Bash\(([^)]*?):\*\)/g)].map(([, p]) => p);
    for (const [, run] of text.matchAll(/!`([^`]*)`/g)) {
      for (const part of run.replaceAll('"', '').split(/\|\||&&|\||;/).map((s) => s.trim())) {
        assert.ok(allowed.some((p) => part === p || part.startsWith(`${p} `)), `${name}: "${part}" is not in allowed-tools`);
      }
    }
  }
});

test('catchup preloads soloagile next, not the whole board (#171)', () => {
  const text = readFileSync(join(SKILLS, 'catchup', 'SKILL.md'), 'utf8');
  assert.match(text, /!`"\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/soloagile" next/);
  assert.doesNotMatch(text, /!`[^`]*soloagile" board/);
});
