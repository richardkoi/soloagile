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
