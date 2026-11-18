import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const head = readFileSync(new URL('../template/head.html', import.meta.url), 'utf8');

test('head.html has no global rule cutting every transition under reduced motion (#262)', () => {
  assert.ok(!/transition-duration:\s*0\.01ms/.test(head), 'no blanket 0.01ms transition rule');
  assert.ok(!/\*,\s*\*::before,\s*\*::after\s*\{[^}]*transition/.test(head), 'no * rule that sets transitions');
});
