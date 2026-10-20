import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import './isolate.js';
import { readTemplate } from '../src/build.js';
import { addPicture, readPictures } from '../src/design.js';
import { renderPage } from '../src/page.js';
import { findBrowser } from '../src/shots.js';

const BOARD = `# Board
<!-- next-id: 13 -->
## Ideas
## Up next
## Doing
## Needs your look
## Needs your decision
- #12 Stage strip · M1 · 5 pts · design · asked 2026-10-02
  how a card shows its stage
  a) A bar of six blocks (recommended)
  b) Six dots
  c) Something else: tell Claude
## Done
`;

function project() {
  const repo = mkdtempSync(join(tmpdir(), 'pm-design-'));
  mkdirSync(join(repo, 'pm'));
  writeFileSync(join(repo, 'pm', 'board.md'), BOARD);
  return repo;
}

// A PNG's first 24 bytes are enough to say how big it is.
function png(width, height) {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
const fakeShoot = async (url, file) => (writeFileSync(file, png(720, 400)), file);

test("an option's picture shows under that option, in the card's pop-up", () => {
  const md = { board: BOARD, plan: '', releases: '', overview: '', decisions: '', links: '' };
  const pictures = { '12-a': { src: 'designs/12-a.png?v=5', width: 360, height: 200 }, '99-b': { src: 'designs/99-b.png?v=6', width: 360, height: 200 } };
  const { html } = renderPage({ name: 'demo', md, builtAt: new Date(2026, 9, 2), template: readTemplate('page.html'), pictures });
  assert.match(html, /<li>a\) A bar of six blocks \(recommended\)<a class="pic-open" href="designs\/12-a\.png\?v=5" target="_blank" title="Open full size in a new tab"><img class="option-pic" src="designs\/12-a\.png\?v=5" width="360" height="200" alt="Option a, as a picture" loading="lazy"><\/a><\/li>/);
  assert.doesNotMatch(html, /createObjectURL/, 'a plain link opens the picture');
  assert.match(html, /<li>b\) Six dots<\/li>/, 'an option with no picture is plain');
  assert.doesNotMatch(html, /99-b/, "another card's picture is left out");
});

test('a card with pictures shows a photo icon and how many, on its face', () => {
  const md = { board: BOARD, plan: '', releases: '', overview: '', decisions: '', links: '' };
  const pic = { src: 'designs/x.png', width: 360, height: 200 };
  const face = (pictures) => renderPage({ name: 'demo', md, builtAt: new Date(2026, 9, 2), template: readTemplate('page.html'), pictures }).html.split('<div class="card-modal"')[0];
  assert.match(face({ '12-a': pic, '12-b': pic }), /<span class="tag tag-pics" title="2 pictures inside"><svg[^>]*>.*?<\/svg>2<\/span>/);
  assert.match(face({ '12-a': pic, '99-b': pic }), /title="1 picture inside"><svg[^>]*>.*?<\/svg>1<\/span>/, "another card's picture is not counted");
  assert.doesNotMatch(face({ '12-z': pic }), /class="tag tag-pics"/, 'a picture for no option of the card shows nothing');
  assert.doesNotMatch(face({}), /class="tag tag-pics"/, 'a card without pictures shows nothing');
});

test('soloagile design stores the picture, keeps it out of git and rebuilds the page linking it', async () => {
  const repo = project();
  const asked = [];
  const { file } = await addPicture(repo, '12', 'b', join(repo, 'mock.html'), undefined, (url, to, width) => (asked.push([url, width]), fakeShoot(url, to)));
  assert.equal(file, join(repo, 'pm', 'designs', '12-b.png'));
  assert.deepEqual(asked, [[`file://${join(repo, 'mock.html')}`, 360]], 'a file becomes an address, at phone width');
  assert.deepEqual(readPictures(join(repo, 'pm'))['12-b'].width, 360, 'drawn at twice the size, shown at half the pixels');
  assert.match(readFileSync(join(repo, '.gitignore'), 'utf8'), /^pm\/designs\/$/m);
  assert.match(readFileSync(join(repo, 'pm', 'index.html'), 'utf8'), /<li>b\) Six dots<a class="pic-open"[^>]*><img class="option-pic" src="designs\/12-b\.png\?v=\d+" width="360" height="200"/);
  assert.doesNotMatch(readFileSync(join(repo, 'pm', 'index.html'), 'utf8'), /data:image\/png/, 'the page holds no picture itself');
  await addPicture(repo, '12', 'a', 'http://127.0.0.1:9/mock', 1000, (url, to, width) => (asked.push([url, width]), fakeShoot(url, to)));
  assert.deepEqual(asked[1], ['http://127.0.0.1:9/mock', 1000], 'an address is used as given');
});

test('soloagile design refuses a card number, letter or width it cannot use', async () => {
  const repo = project();
  for (const [id, letter, source, width] of [['x', 'a', 'm.html'], ['12', 'ab', 'm.html'], ['12', 'a', ''], ['12', 'a', 'm.html', 50], ['12', 'a', 'm.html', NaN]]) {
    await assert.rejects(addPicture(repo, id, letter, source, width, fakeShoot), /usage: soloagile design/);
  }
  await assert.rejects(addPicture(mkdtempSync(join(tmpdir(), 'pm-design-')), '12', 'a', 'm.html', 360, fakeShoot), /no pm\/board\.md/);
  assert.ok(!existsSync(join(repo, 'pm', 'designs')));
});

test('the picture is the whole mock-up and nothing more', { skip: !findBrowser() && 'no headless Chromium here' }, async () => {
  const repo = project();
  writeFileSync(join(repo, 'mock.html'), '<!doctype html><body style="margin:0"><div style="height:150px;background:#345">mock-up</div>');
  await addPicture(repo, '12', 'a', join(repo, 'mock.html'));
  assert.deepEqual(readPictures(join(repo, 'pm'))['12-a'].width, 360);
  assert.deepEqual(readPictures(join(repo, 'pm'))['12-a'].height, 150, 'as tall as its content, not the window');
});
