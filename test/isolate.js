// Keeps the tests off the real ~/.soloagile, and leaves nothing behind. Each test file gets
// one folder of its own, removed when its tests end. Settings and the home page live in it.
// So does every temp folder a test makes, or the code under it: os.tmpdir() follows TMPDIR,
// which is pointed inside. The settings name a page server, and a projects folder that
// starts empty, so a throwaway project made elsewhere is on no home page. Import this
// before anything in src/.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'soloagile-'));
export const SERVED_FOLDER = join(dir, 'projects');
mkdirSync(SERVED_FOLDER);
mkdirSync(join(dir, 'tmp'));
writeFileSync(join(dir, 'settings.json'), JSON.stringify({ pageUrl: 'http://pages.test/{project}/', projectsFolder: SERVED_FOLDER }));
process.env.SOLOAGILE_DIR = dir;
process.env.TMPDIR = join(dir, 'tmp');
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
