// Which soloagile this is, and whether a newer one is installed beside it.
// Claude Code keeps each plugin version in its own folder, such as
// ~/.claude/plugins/cache/soloagile/soloagile/0.1.12/, and a session keeps the version it
// started with. Without a hand-off, a session started before an update would rebuild
// pages with the old code, over pages the new code had built.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

// Compares two "1.2.3" versions: below 0 when a is older, 0 when equal, above 0 when newer.
export function compareVersions(a, b) {
  const [x, y] = [a, b].map((v) => (SEMVER.exec(v) ?? [0, 0, 0, 0]).slice(1).map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// The bin/soloagile of the newest version installed beside `root`, when it is newer than
// `version`; otherwise null. Only a folder named after its version counts, so a git
// checkout, whose folder is named soloagile, never hands off.
export function newerInstall(root = ROOT, version = VERSION) {
  const here = root.replace(/\/+$/, '').split('/').pop();
  if (!SEMVER.test(here)) return null;
  let newest = null;
  for (const v of readdirSync(dirname(root))) {
    if (!SEMVER.test(v) || compareVersions(v, newest ?? version) <= 0) continue;
    if (existsSync(join(dirname(root), v, 'bin', 'soloagile'))) newest = v;
  }
  return newest && join(dirname(root), newest, 'bin', 'soloagile');
}

// The version that built a page, from its generator line; null for a page built before 0.1.12.
export function builtBy(page) {
  try {
    return /<meta name="generator" content="soloagile (\d+\.\d+\.\d+)">/.exec(readFileSync(page, 'utf8'))?.[1] ?? null;
  } catch {
    return null;
  }
}
