import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'release.sh');
const run = (...a) => spawnSync(SCRIPT, a, { encoding: 'utf8' });

test('tools/release.sh refuses a missing or old version before running anything (#192)', () => {
  const none = run();
  assert.equal(none.status, 2);
  assert.match(none.stderr, /usage: tools\/release\.sh <version>/);
  assert.equal(run('1.20', 'x').status, 2, 'not a full version');
  assert.equal(run('1.0.0', 'x').status, 2);
  assert.match(run('1.0.0', 'x').stderr, /is not newer than/);
  assert.doesNotMatch(run('1.0.0', 'x').stdout, /release: tests/, 'stopped before the checks');
});

const NOTE = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'release-note.sh');

test('tools/release-note.sh prints one version\'s note from a releases file (#203)', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'release-note-'));
  const file = join(dir, 'releases.md');
  writeFileSync(file, [
    '# Release notes', '', 'Newest first.', '',
    '## 2026-11-05 · soloagile 1.20.0: clean releases', 'New things.', '', '**Cards:** #180', '',
    '## 2026-11-05 · M26 soloagile herdr command: done', 'Milestone text.', '',
    '## 2026-11-05 · soloagile 1.19.0: soloagile herdr', 'Older things.', '',
  ].join('\n'));
  try {
    const got = spawnSync(NOTE, ['1.20.0', file], { encoding: 'utf8' });
    assert.equal(got.status, 0);
    assert.equal(got.stdout.trim(), 'New things.\n\n**Cards:** #180');
    const old = spawnSync(NOTE, ['1.19.0', file], { encoding: 'utf8' });
    assert.equal(old.stdout.trim(), 'Older things.');
    const missing = spawnSync(NOTE, ['1.2.0', file], { encoding: 'utf8' });
    assert.equal(missing.status, 1, 'no note for that version');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
