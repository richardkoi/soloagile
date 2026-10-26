// A card's own page of pictures, for the user's look (#141), and the script that takes
// them again (#142).
//   soloagile pictures <card> [files…] [--url <address>]… [--caption "…"]… [--by "<command>"]
// copies the files (and, for each --url, soloagile shots' four pictures) into
// pm/designs/card-<n>/, with an index.html showing each under its caption. --by names the
// command that made the files, so they can be made again. The whole run is written to
// pm/takes/card-<n>.sh, kept with the project; `soloagile retake <n>` runs it. The pictures
// stay out of git, like the option pictures beside them; the script is kept.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { ensureLine } from './init.js';
import { takeShots } from './shots.js';

export const cardFolder = (repo, id) => join(resolve(repo), 'pm', 'designs', `card-${id}`);
export const takeScript = (repo, id) => join(resolve(repo), 'pm', 'takes', `card-${id}.sh`);
const KINDS = /\.(png|jpe?g|webp|gif|mp4|webm)$/i;

export function parsePictureArgs(args) {
  const out = { id: null, files: [], urls: [], captions: [], by: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i] ?? (() => { throw new Error(`${a} needs a value`); })();
    if (a === '--url') out.urls.push(next());
    else if (a === '--caption') out.captions.push(next());
    else if (a === '--by') out.by = next();
    else if (out.id === null) out.id = /^#?\d+$/.test(a) ? Number(a.replace('#', '')) : (() => { throw new Error(`the first word is the card's number, not "${a}"`); })();
    else out.files.push(a);
  }
  if (out.id === null || (!out.files.length && !out.urls.length)) {
    throw new Error('usage: soloagile pictures <card> [files…] [--url <address>]… [--caption "…"]… [--by "<command>"]');
  }
  for (const f of out.files) {
    if (!KINDS.test(f)) throw new Error(`${f}: a picture or film is .png, .jpg, .webp, .gif, .mp4 or .webm`);
  }
  return out;
}

// "2026-10-20 15:52" in the machine's own time.
const localStamp = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// The page: each picture full width under its caption, a film with its controls.
export function galleryHtml({ id, title, figures, takenAt }) {
  const figure = ({ file, caption }) => {
    const src = encodeURI(file);
    const media = /\.(mp4|webm)$/i.test(file)
      ? `<video src="${src}" controls preload="metadata"></video>`
      : `<a href="${src}" target="_blank"><img src="${src}" alt="${esc(caption || file)}"></a>`;
    return `<figure>${media}<figcaption>${esc(caption || file)}</figcaption></figure>`;
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>#${id} pictures</title>
<style>
:root { color-scheme: dark; --bg: #0D100D; --surface: #161A15; --line: #2A2E26; --text: #E8E0CE; --muted: #A8A18E; }
@media (prefers-color-scheme: light) { :root { color-scheme: light; --bg: #F5EDE0; --surface: #FBF6EF; --line: #E4D8C4; --text: #1A1210; --muted: #554C40; } }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 24px; margin: 0 0 4px; }
.sub { color: var(--muted); margin: 0 0 20px; font-size: 14px; }
figure { margin: 0 0 16px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
img, video { display: block; max-width: 100%; height: auto; margin: 0 auto; }
figure a { display: block; background: var(--bg); }
figcaption { padding: 10px 14px; font-size: 15px; }
</style></head>
<body><main>
<h1>#${id} ${esc(title ?? '')}</h1>
<p class="sub">${figures.length} picture${figures.length === 1 ? '' : 's'}, taken ${esc(takenAt)} · again with <code>soloagile retake ${id}</code></p>
${figures.map(figure).join('\n')}
</main></body></html>
`;
}

// Makes the card's page. `shoot` takes a page's four pictures (the tests pass their own).
export async function makePictures(repo, { id, files, urls, captions, by }, { title = null, takenAt = localStamp(), shoot = takeShots, argv = null } = {}) {
  repo = resolve(repo);
  if (by) {
    // A --by that leads back here loops without end: on 26 Oct mohawk's card-93.sh ran
    // itself ~770 deep and filled memory. Refuse the card's own kept script, a retake,
    // and any --by started inside another --by.
    if (process.env.SOLOAGILE_IN_BY) throw new Error(`--by refused: it ran inside another --by (${process.env.SOLOAGILE_IN_BY}), which would loop`);
    if (by.includes(`card-${id}.sh`) || /\bretake\b/.test(by)) throw new Error(`--by refused: "${by}" runs itself, card #${id}'s kept script; give the command that makes the pictures, or leave --by out`);
    const run = spawnSync('sh', ['-c', by], { cwd: repo, encoding: 'utf8', env: { ...process.env, SOLOAGILE_IN_BY: by } });
    if (run.status !== 0) throw new Error(`--by failed: ${by}\n${run.stdout}${run.stderr}`);
  }
  const folder = cardFolder(repo, id);
  rmSync(folder, { recursive: true, force: true }); // a retake replaces every picture
  mkdirSync(folder, { recursive: true });
  ensureLine(join(repo, '.gitignore'), 'pm/designs/');
  const figures = [];
  let c = 0;
  for (const f of files) {
    const from = resolve(repo, f);
    if (!existsSync(from)) throw new Error(`${f}: no such file`);
    // Plain names only, so the page server's narrow rule serves them.
    let name = basename(from).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]/, 'x');
    if (figures.some((x) => x.file === name)) name = `${figures.length + 1}-${name}`;
    copyFileSync(from, join(folder, name));
    figures.push({ file: name, caption: captions[c++] ?? '' });
  }
  for (const [u, url] of urls.entries()) {
    const caption = captions[c++] ?? url;
    for (const shot of await shoot(url)) {
      const name = `page${u + 1}-${basename(shot)}`;
      copyFileSync(shot, join(folder, name));
      figures.push({ file: name, caption: `${caption} · ${basename(shot, extname(shot)).replace('-', ', ')}` });
    }
  }
  writeFileSync(join(folder, 'index.html'), galleryHtml({ id, title, figures, takenAt }));
  if (argv) writeTake(repo, id, by, argv);
  return { folder, figures };
}

// The script that takes card <id>'s pictures again: the --by command runs inside the
// soloagile pictures line it was given to, so the script is that one line.
function writeTake(repo, id, by, argv) {
  const file = takeScript(repo, id);
  mkdirSync(join(repo, 'pm', 'takes'), { recursive: true });
  writeFileSync(file, `#!/bin/sh
# Takes card #${id}'s pictures again, into pm/designs/card-${id}/: soloagile retake ${id}
# Written by soloagile pictures${by ? `; it runs: ${by.replace(/\n/g, ' ')}` : ''}.
set -e
cd "$(dirname "$0")/../.."
soloagile pictures ${argv.map(quote).join(' ')}
`);
  chmodSync(file, 0o755);
}

// How many pictures each card's page holds, by card number, for the board's pop-ups.
export function readCardPages(pmDir) {
  const folder = join(pmDir, 'designs');
  const pages = {};
  if (!existsSync(folder)) return pages;
  for (const f of readdirSync(folder)) {
    const id = f.match(/^card-(\d+)$/)?.[1];
    if (!id || !existsSync(join(folder, f, 'index.html'))) continue;
    pages[id] = readdirSync(join(folder, f)).filter((x) => KINDS.test(x)).length;
  }
  return pages;
}
