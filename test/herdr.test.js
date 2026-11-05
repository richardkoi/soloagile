import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';
import { installHerdr, installedSound } from '../src/herdr.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PM = join(ROOT, 'bin', 'soloagile');
const SOURCE = join(ROOT, 'herdr');
const newHerdr = (keys = { global: { f2: 'tab.rename' } }) => {
  const dir = mkdtempSync(join(tmpdir(), 'herdr-'));
  writeFileSync(join(dir, 'keys.json'), JSON.stringify(keys, null, 2));
  return dir;
};

test('a first run installs the three add-ons and binds F3; a second run changes nothing', () => {
  const herdr = newHerdr();
  const first = installHerdr({ herdr, source: SOURCE });
  assert.equal(first.key, 'added');
  assert.ok(first.changed.includes('keys.json'));
  for (const mod of ['soloagile-board', 'soloagile-picture', 'soloagile-alerts']) {
    assert.equal(readFileSync(join(herdr, 'mods', mod, 'main.js'), 'utf8'), readFileSync(join(SOURCE, 'mods', mod, 'main.js'), 'utf8'));
  }
  const keys = JSON.parse(readFileSync(join(herdr, 'keys.json'), 'utf8'));
  assert.deepEqual(keys.global, { f2: 'tab.rename', f3: 'mod.open:soloagile-board' });
  assert.equal(first.sound, 'blocked');
  assert.deepEqual(installHerdr({ herdr, source: SOURCE }).changed, []);
});

test('an update keeps the sound the installed alerts use, and --sound copies a file in', () => {
  const herdr = newHerdr();
  installHerdr({ herdr, source: SOURCE });
  const alerts = join(herdr, 'mods', 'soloagile-alerts', 'main.js');
  writeFileSync(alerts, readFileSync(alerts, 'utf8').replace('"blocked"', '"sounds/bell.mp3"').replace('const', '// an older copy\nconst'));
  const update = installHerdr({ herdr, source: SOURCE });
  assert.deepEqual(update.changed, ['mods/soloagile-alerts/main.js']);
  assert.equal(installedSound(herdr), 'sounds/bell.mp3');
  assert.doesNotMatch(readFileSync(alerts, 'utf8'), /an older copy/);

  const wav = join(mkdtempSync(join(tmpdir(), 'sound-')), 'ding.wav');
  writeFileSync(wav, Buffer.from([1, 2, 3]));
  const set = installHerdr({ herdr, source: SOURCE, sound: wav });
  assert.equal(set.sound, 'sounds/ding.wav');
  assert.ok(existsSync(join(herdr, 'sounds', 'ding.wav')));
  assert.equal(installedSound(herdr), 'sounds/ding.wav');
  assert.deepEqual(installHerdr({ herdr, source: SOURCE }).changed, []);
});

test('F3 bound to something else is left alone, and a dry run writes nothing', () => {
  const herdr = newHerdr({ global: { f3: 'app.help' } });
  const dry = installHerdr({ herdr, source: SOURCE, dryRun: true });
  assert.equal(dry.key, 'app.help');
  assert.ok(dry.changed.length >= 3);
  assert.equal(existsSync(join(herdr, 'mods')), false);
  installHerdr({ herdr, source: SOURCE });
  assert.equal(JSON.parse(readFileSync(join(herdr, 'keys.json'), 'utf8')).global.f3, 'app.help');
});

test('soloagile herdr reports what it did, and refuses when Herdr is not set up', () => {
  const herdr = newHerdr();
  const run = (env) => spawnSync(PM, ['herdr'], { encoding: 'utf8', env: { ...process.env, ...env } });
  const r = run({ HERDR_CONFIG_DIR: herdr });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /changed \d+ files in the Herdr folder/);
  assert.match(r.stdout, /F3 now opens the board/);
  assert.match(run({ HERDR_CONFIG_DIR: herdr }).stdout, /add-ons are up to date/);
  const none = run({ HERDR_CONFIG_DIR: join(herdr, 'missing') });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /Herdr isn't set up here/);
});

test('session start updates installed add-ons that are older, keeping the sound and the keys', async () => {
  const { refreshHerdr } = await import('../src/herdr.js');
  const { sessionStartOutput } = await import('../src/session.js');
  const herdr = process.env.HERDR_CONFIG_DIR;
  assert.equal(refreshHerdr(herdr), null, 'nothing when the add-ons are not installed');
  mkdirSync(herdr, { recursive: true });
  writeFileSync(join(herdr, 'keys.json'), '{"global":{}}');
  installHerdr({ herdr, bindKey: false });
  const board = join(herdr, 'mods', 'soloagile-board', 'main.js');
  writeFileSync(board, '// an older copy\n');
  const repo = mkdtempSync(join(tmpdir(), 'herdr-project-'));
  writeFileSync(join(repo, 'NEXT_SESSION.md'), 'note\n');
  assert.match(sessionStartOutput({ cwd: repo }).systemMessage, / · updated the Herdr add-ons$/);
  assert.equal(readFileSync(board, 'utf8'), readFileSync(join(SOURCE, 'mods', 'soloagile-board', 'main.js'), 'utf8'));
  assert.equal(readFileSync(join(herdr, 'keys.json'), 'utf8'), '{"global":{}}', 'keys left alone');
  assert.doesNotMatch(sessionStartOutput({ cwd: repo }).systemMessage, /Herdr/);
});
