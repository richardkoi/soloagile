// `soloagile herdr`: installs or updates the Herdr add-ons (herdr/mods) in the user's
// Herdr folder, keeping the sound their alerts already use, and binds F3 to the board
// unless F3 is taken. Writes only files that differ, so a second run changes nothing.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { ROOT } from './version.js';

export const MODS = ['soloagile-board', 'soloagile-picture', 'soloagile-alerts'];
const KEY = 'f3';
const ACTION = 'mod.open:soloagile-board';
// The alerts' sound is one line of its main.js: a Herdr sound name, or a file under the Herdr folder.
const SOUND_LINE = /^const SOUND = "([^"]*)";.*$/m;

export const herdrFolder = (env = process.env) => env.HERDR_CONFIG_DIR || join(homedir(), '.config', 'herdr-app');

const readOr = (file, fallback = null) => (existsSync(file) ? readFileSync(file, 'utf8') : fallback);

// The sound the installed alerts use, or null when they aren't installed.
export function installedSound(herdr) {
  const js = readOr(join(herdr, 'mods', 'soloagile-alerts', 'main.js'));
  return js ? (SOUND_LINE.exec(js)?.[1] ?? null) : null;
}

// What every add-on file should hold, as { 'mods/<mod>/<file>': text }, with the sound set.
function wanted(source, sound) {
  const files = {};
  for (const mod of MODS) {
    for (const name of readdirSync(join(source, 'mods', mod))) {
      let text = readFileSync(join(source, 'mods', mod, name), 'utf8');
      if (mod === 'soloagile-alerts' && name === 'main.js' && sound) {
        text = text.replace(SOUND_LINE, (line, old) => line.replace(`"${old}"`, JSON.stringify(sound)));
      }
      files[join('mods', mod, name)] = text;
    }
  }
  return files;
}

// Installs or updates. `sound`: a Herdr sound name, or a file to copy into <herdr>/sounds.
// `dryRun` only reports. Returns { changed: [paths], sound, key: 'added'|'kept'|<other action> }.
export function installHerdr({ herdr = herdrFolder(), source = join(ROOT, 'herdr'), sound = null, dryRun = false, bindKey = true } = {}) {
  if (!existsSync(herdr)) throw new Error(`Herdr isn't set up here: no ${herdr}`);
  if (!existsSync(join(source, 'mods'))) throw new Error(`no add-ons to install: no ${join(source, 'mods')}`);
  const changed = [];

  // A file given as the sound is kept in Herdr's sounds folder, where the alerts can read it.
  if (sound && existsSync(sound)) {
    const into = join('sounds', basename(sound));
    const there = join(herdr, into);
    if (resolve(sound) !== resolve(there) && !(existsSync(there) && readFileSync(there).equals(readFileSync(sound)))) {
      changed.push(into);
      if (!dryRun) {
        mkdirSync(join(herdr, 'sounds'), { recursive: true });
        copyFileSync(sound, join(herdr, into));
      }
    }
    sound = into;
  }
  sound = sound || installedSound(herdr);

  for (const [path, text] of Object.entries(wanted(source, sound))) {
    if (readOr(join(herdr, path)) === text) continue;
    changed.push(path);
    if (!dryRun) {
      mkdirSync(join(herdr, path, '..'), { recursive: true });
      writeFileSync(join(herdr, path), text);
    }
  }

  // F3 opens the board, unless the user has F3 doing something else.
  const keysFile = join(herdr, 'keys.json');
  const keys = JSON.parse(readOr(keysFile, '{}'));
  const bound = keys.global?.[KEY];
  let key = 'kept';
  if (!bound && bindKey) {
    key = 'added';
    changed.push('keys.json');
    if (!dryRun) writeFileSync(keysFile, JSON.stringify({ ...keys, global: { ...keys.global, [KEY]: ACTION } }, null, 2) + '\n');
  } else if (bound && bound !== ACTION) key = bound;

  const used = sound || SOUND_LINE.exec(readFileSync(join(source, 'mods', 'soloagile-alerts', 'main.js'), 'utf8'))?.[1];
  return { changed, sound: used, key };
}

// What `soloagile herdr` prints.
export function herdrText({ changed, sound, key }, dryRun = false) {
  const lines = [];
  if (!changed.length) lines.push('soloagile: the Herdr add-ons are up to date');
  else lines.push(`soloagile: ${dryRun ? 'would change' : 'changed'} ${changed.length} file${changed.length === 1 ? '' : 's'} in the Herdr folder: ${changed.join(', ')}`);
  lines.push(`soloagile: the alerts' sound is ${sound}`);
  if (key === 'added') lines.push('soloagile: F3 now opens the board');
  else if (key !== 'kept') lines.push(`soloagile: F3 is taken (${key}), so it wasn't changed; bind "mod.open:soloagile-board" in keys.json`);
  return lines.join('\n');
}

// For session start: when the add-ons are installed and older than this plugin's copy,
// update them, keeping the sound and leaving keys.json alone. Returns a line, or null.
export function refreshHerdr(herdr = herdrFolder()) {
  if (!existsSync(join(herdr, 'mods', 'soloagile-board'))) return null;
  const { changed } = installHerdr({ herdr, bindKey: false });
  return changed.length ? 'updated the Herdr add-ons' : null;
}
