import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './isolate.js';
import { makePictures, parsePictureArgs, readCardPages } from '../src/pictures.js';

const PM = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'soloagile');
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
function project() {
  const repo = mkdtempSync(join(tmpdir(), 'soloagile-pics-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), '# Board\n<!-- next-id: 8 -->\n## Ideas\n## Up next\n## Doing\n- #7 The drones · M1 · 3 pts · develop\n  done when: x\n## Needs your look\n## Needs your decision\n## Done\n');
  writeFileSync(join(repo, 'pm', 'plan.md'), '# Alpha\n### M1 — First · in progress\nshort: First\n');
  writeFileSync(join(repo, 'front.png'), PNG);
  return repo;
}

test('the arguments: a card number, files, addresses, captions in order, and the command that made them', () => {
  assert.deepEqual(parsePictureArgs(['#7', 'a.png', '--caption', 'From the front', '--url', 'http://x/', '--by', 'node make.mjs']), {
    id: 7, files: ['a.png'], urls: ['http://x/'], captions: ['From the front'], by: 'node make.mjs',
  });
  assert.throws(() => parsePictureArgs(['7']), /usage: soloagile pictures/);
  assert.throws(() => parsePictureArgs(['seven', 'a.png']), /card's number/);
  assert.throws(() => parsePictureArgs(['7', 'notes.txt']), /picture or film/);
});

test("a card's page: each file under its caption, an address's four pictures, and a retake replaces them", async () => {
  const repo = project();
  const shoot = async () => ['desktop-dark', 'phone-light'].map((n) => {
    const f = join(repo, `${n}.png`);
    writeFileSync(f, PNG);
    return f;
  });
  const { folder, figures } = await makePictures(repo, parsePictureArgs(['7', 'front.png', '--caption', 'From the front', '--url', 'http://x/', '--caption', 'The page']), { title: 'The drones', takenAt: '2026-10-20 16:00', shoot });
  assert.deepEqual(figures.map((f) => [f.file, f.caption]), [
    ['front.png', 'From the front'],
    ['page1-desktop-dark.png', 'The page · desktop, dark'],
    ['page1-phone-light.png', 'The page · phone, light'],
  ]);
  const html = readFileSync(join(folder, 'index.html'), 'utf8');
  assert.match(html, /<h1>#7 The drones<\/h1>/);
  assert.match(html, /<img src="front\.png" alt="From the front".*<figcaption>From the front<\/figcaption>/);
  assert.deepEqual(readCardPages(join(repo, 'pm')), { 7: 3 });
  await makePictures(repo, parsePictureArgs(['7', 'front.png']), { shoot });
  assert.deepEqual(readdirSync(folder).sort(), ['front.png', 'index.html'], 'a retake starts clean');
  assert.match(readFileSync(join(repo, '.gitignore'), 'utf8'), /^pm\/designs\/$/m, 'the pictures stay out of git');
});

test('soloagile pictures notes the page on the card and links it from the pop-up; retake runs the kept script', () => {
  const repo = project();
  const made = spawnSync(PM, ['pictures', '7', 'made.png', '--caption', 'Made by a script', '--by', `cp front.png made.png`], { cwd: repo, encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  assert.match(readFileSync(join(repo, 'pm', 'board.md'), 'utf8'), /^  pictures: \S+designs\/card-7\/index\.html$/m);
  const page = readFileSync(join(repo, 'pm', 'index.html'), 'utf8');
  assert.match(page, /<a class="pic-page" href="designs\/card-7\/index\.html" target="_blank">.*Open its picture page \(1\)<\/a>/);
  const script = join(repo, 'pm', 'takes', 'card-7.sh');
  assert.match(readFileSync(script, 'utf8'), /soloagile pictures '7' 'made\.png' '--caption' 'Made by a script' '--by' 'cp front\.png made\.png'/);

  spawnSync('rm', ['-r', join(repo, 'pm', 'designs'), join(repo, 'made.png')]);
  const again = spawnSync(PM, ['retake', '7'], { cwd: repo, encoding: 'utf8' });
  assert.equal(again.status, 0, again.stderr);
  assert.ok(existsSync(join(repo, 'pm', 'designs', 'card-7', 'made.png')), 'the --by command ran again and the page came back');
  assert.equal(readFileSync(join(repo, 'pm', 'board.md'), 'utf8').match(/pictures:/g).length, 1, 'the address is noted once');
  assert.equal(spawnSync(PM, ['retake', '9'], { cwd: repo }).status, 1);
});

// Card #93 in mohawk, 26 Oct: a kept script whose --by ran itself started ~770 copies
// and filled the terminal's memory. Both shapes of that loop are refused.
test('a --by that runs the card\'s own kept script is refused, not looped', () => {
  const repo = project();
  assert.equal(spawnSync(PM, ['pictures', '7', 'front.png'], { cwd: repo }).status, 0);
  const r = spawnSync(PM, ['pictures', '7', 'front.png', '--by', 'pm/takes/card-7.sh'], { cwd: repo, encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 1, `exit ${r.status} ${r.signal ?? ''}`);
  assert.match(r.stderr, /runs itself/);
  assert.doesNotMatch(readFileSync(join(repo, 'pm', 'takes', 'card-7.sh'), 'utf8'), /--by/, 'the kept script is left as it was');
});

test('a --by that starts another soloagile pictures --by inside it is refused', () => {
  const repo = project();
  const inner = `${PM} pictures 7 front.png --by true`;
  const r = spawnSync(PM, ['pictures', '7', 'front.png', '--by', inner], { cwd: repo, encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 1, `exit ${r.status} ${r.signal ?? ''}`);
  assert.match(r.stdout + r.stderr, /inside another --by/);
});
