// Pictures for a design card's options, so the user chooses from what each would look like.
// `soloagile design <card> <letter> <mock-up>` photographs a mock-up into
// pm/designs/<card>-<letter>.png, and the page shows it under that option in the card's
// pop-up. The pictures are kept out of git: they matter only until the card is done.
import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildProject } from './build.js';
import { ensureLine } from './init.js';
import { takePicture } from './shots.js';

const NAME = /^(\d+-[a-z])\.png$/;

// Every picture in <repo>/pm/designs, keyed "<card>-<letter>", as an address beside the
// page: designs/12-a.png works for a page opened as a file, and on the page server, which
// serves pm/designs/ too. The page links the pictures rather than holding them, so it
// stays small. "?v=" changes when a picture is retaken, so the browser never shows an old
// one. A picture is taken at twice its size, so it is shown at half its pixels.
export function readPictures(dir) {
  const folder = join(dir, 'designs');
  const pictures = {};
  if (!existsSync(folder)) return pictures;
  for (const f of readdirSync(folder)) {
    const key = f.match(NAME)?.[1];
    if (!key) continue;
    // PNG: the width and height are the two big-endian numbers after the IHDR tag, in the
    // first 24 bytes, so only those are read.
    const head = Buffer.alloc(24);
    const fd = openSync(join(folder, f), 'r');
    readSync(fd, head, 0, 24, 0);
    closeSync(fd);
    const v = Math.round(statSync(join(folder, f)).mtimeMs / 1000);
    pictures[key] = { src: `designs/${f}?v=${v}`, width: Math.round(head.readUInt32BE(16) / 2), height: Math.round(head.readUInt32BE(20) / 2) };
  }
  return pictures;
}

// `source` is a mock-up: an address, or an HTML file. `width` is how wide to draw it;
// 360 is a small phone's width, and what fits a card's pop-up without shrinking.
export async function addPicture(repoPath, id, letter, source, width = 360, shoot = takePicture) {
  const repo = resolve(repoPath);
  if (!existsSync(join(repo, 'pm', 'board.md'))) throw new Error(`no pm/board.md in ${repo}`);
  if (!/^\d+$/.test(id) || !/^[a-z]$/.test(letter) || !source || !(width >= 200 && width <= 1400)) {
    throw new Error('usage: soloagile design <card number> <option letter> <mock-up address or .html file> [width, 200 to 1400]');
  }
  const url = /^[a-z]+:\/\//.test(source) ? source : pathToFileURL(resolve(source)).href;
  mkdirSync(join(repo, 'pm', 'designs'), { recursive: true });
  ensureLine(join(repo, '.gitignore'), 'pm/designs/');
  const file = await shoot(url, join(repo, 'pm', 'designs', `${id}-${letter}.png`), width);
  return { file, ...buildProject(repo) };
}
