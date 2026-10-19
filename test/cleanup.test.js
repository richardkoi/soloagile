import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';
import { findBrowser, withPage } from '../src/shots.js';

const HERE = dirname(fileURLToPath(import.meta.url));

test("a test file's temp folders are gone when it ends", () => {
  // A stand-in for a test file: it makes a temp folder the way the tests do, and says where.
  const script = "import './isolate.js'; import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; console.log(mkdtempSync(join(tmpdir(), 'pm-made-')));";
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: HERE, encoding: 'utf8' });
  const made = r.stdout.trim();
  assert.match(made, /pm-made-/, r.stderr);
  assert.ok(!existsSync(made), `${made} was left behind`);
});

test('no browser profile is left behind', { skip: !findBrowser() && 'no headless Chromium here' }, async () => {
  for (let i = 0; i < 3; i++) await withPage('about:blank', async () => {});
  // A browser still closing would write its profile back a moment after it was removed.
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(readdirSync(tmpdir()).filter((name) => name.startsWith('pm-shots-profile-')), []);
});
