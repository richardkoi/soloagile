// The build fleet's preflight (#233): Ada's checks before a fleet run, a lock so one card
// runs once at a time, and the stage a run starts or resumes at. A run's files live in
// pm/runs/<card>/; the lock is pm/runs/<card>/lock, holding the pid and start time.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readArchive } from './archive.js';
import { parseBoard } from './board.js';
import { moveCard } from './card.js';
import { localDate } from './init.js';

// Each stage leaves one file; a run resumes at the first one missing. The security list is
// written only when the script finds something (#238), so it isn't a stage of its own here.
export const STAGE_FILES = [['plan', 'plan.md'], ['build', 'build.md'], ['review', 'review.md'], ['verdicts', 'verdicts.md'], ['test', 'report.md']];

// The board's Doing stage for each run stage (#266): the card sits in Doing while it runs.
// Cora's design comes after the plan, so a run starting at plan is at design too.
export const DOING_STAGE = { plan: 'design', build: 'develop', review: 'test', verdicts: 'test', test: 'test', done: 'test' };

export const runDir = (repo, id) => join(resolve(repo), 'pm', 'runs', String(id));

// A pid is alive when signal 0 reaches it. EPERM means it lives under someone else.
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

// The process the lock belongs to: the Claude session that ran this, found by walking up
// /proc (Linux), so the lock outlives the short shell that called the command. Elsewhere,
// or with no Claude above, the parent process.
export function ownerPid(start = process.ppid) {
  let pid = start;
  for (let i = 0; i < 20 && pid > 1; i++) {
    try {
      if (readFileSync(`/proc/${pid}/comm`, 'utf8').trim() === 'claude') return pid;
      pid = Number(readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[1]);
    } catch {
      break;
    }
  }
  return start;
}

// Refuses with the reason, or locks the card, moves it to Doing at its stage (#266) and says
// where the run starts. Fleet cards may sit in Doing together, one per run.
// Returns { stage, file, cleared, said } where cleared is a stale lock that was removed and
// said is the board's line about the move.
export function preflight(repo, id, { pid = ownerPid(), now = new Date(), isAlive = alive } = {}) {
  const board = readFileSync(join(resolve(repo), 'pm', 'board.md'), 'utf8');
  const card = parseBoard(board).columns.flatMap((c) => c.cards).find((c) => c.id === id);
  if (!card) throw new Error(`#${id} isn't on the board`);
  if (!card.details.some((d) => /^done when:/i.test(d))) throw new Error(`#${id} has no done when, so the crew can't tell when it's built: soloagile card set ${id} --done-when "…"`);
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
  if (status.status !== 0) throw new Error(`${repo} isn't a git repository`);
  const dirty = status.stdout.split('\n').filter((l) => l.trim() && !/^.. pm\//.test(l));
  if (dirty.length) throw new Error(`the tree has uncommitted changes, so a fleet branch would carry them:\n${dirty.join('\n')}`);
  const dir = runDir(repo, id);
  const lockFile = join(dir, 'lock');
  let cleared = null;
  if (existsSync(lockFile)) {
    const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
    if (isAlive(lock.pid)) throw new Error(`#${id} is already running (pid ${lock.pid}, since ${lock.started}); soloagile fleet unlock ${id} if it isn't`);
    cleared = lock; // its run crashed or was stopped: the files it left stay, and the run resumes
  }
  const next = STAGE_FILES.find(([, file]) => !existsSync(join(dir, file)));
  const stage = next ? next[0] : 'done';
  // Worked out before the lock is written, so a card the board refuses (no points, say)
  // leaves neither a lock nor a changed board.
  const moved = moveCard(board, readArchive(repo), { id, lane: 'doing', stage: DOING_STAGE[stage], today: localDate(now) });
  mkdirSync(dir, { recursive: true });
  writeFileSync(lockFile, `${JSON.stringify({ pid, started: now.toISOString() })}\n`);
  writeFileSync(join(resolve(repo), 'pm', 'board.md'), moved.board);
  return { stage, file: next ? next[1] : null, cleared, said: moved.said };
}

export function unlock(repo, id) {
  const lockFile = join(runDir(repo, id), 'lock');
  const was = existsSync(lockFile);
  rmSync(lockFile, { force: true });
  return was;
}

export function preflightText(id, { stage, file, cleared, said }) {
  return [
    cleared && `soloagile: cleared #${id}'s old lock (pid ${cleared.pid}, from ${cleared.started}): that run had stopped`,
    `soloagile: #${id} is locked for its fleet run`,
    stage === 'done' ? `soloagile: every stage file is there; the run is at its end` : `soloagile: start at ${stage}: pm/runs/${id}/${file} isn't written yet`,
    said && `soloagile: ${said}`,
  ].filter(Boolean).join('\n');
}

// Tobin's own copy of the code (#235): a git worktree on branch card-<n>, under
// .claude/worktrees/ where soloagile cleanup clears merged ones. That folder is added to
// the repo's own .git/info/exclude, never to a committed file, so the copy doesn't make the
// main tree look dirty to the next preflight. A second call finds the copy already there.
export function fleetBranch(repo, id) {
  const root = resolve(repo);
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`);
    return r.stdout.trim();
  };
  const branch = `card-${id}`;
  const path = join(root, '.claude', 'worktrees', branch);
  const exclude = resolve(root, git('rev-parse', '--git-path', 'info/exclude'));
  const excluded = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  if (!excluded.split('\n').includes('.claude/worktrees/')) {
    mkdirSync(dirname(exclude), { recursive: true });
    writeFileSync(exclude, `${excluded}${excluded && !excluded.endsWith('\n') ? '\n' : ''}.claude/worktrees/\n`);
  }
  if (existsSync(path)) return { path, branch, made: false };
  const known = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: root }).status === 0;
  if (known) git('worktree', 'add', path, branch);
  else git('worktree', 'add', '-b', branch, path);
  return { path, branch, made: true };
}

// The security scan (#238): a plain search of a change's added lines for keys, tokens, .env,
// logins and permissions. No hits, and Rufus is never started, so a quiet change costs
// nothing. Each hit is { file, line, text, why }, line being the new file's line number.
const RISKY = [
  ['a key or token', /\b(api[_-]?key|secret|token|bearer|private[_-]?key|client[_-]?secret|access[_-]?key)\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(ghp|gho|github_pat|sk|xox[abp])[-_][A-Za-z0-9_]{10,}/i],
  ['a .env file', /(^|[^\w.])\.env\b|\bprocess\.env\b|\bos\.environ\b|\bdotenv\b/],
  ['a login or password', /\b(password|passwd|login|auth|session|cookie|credential|oauth|jwt)\b/i],
  ['a permission', /\b(chmod\w*|chown\w*|sudo|setuid|permissions?|allow(ed)?[-_ ]?tools|cors|access[-_ ]control)\b|\b(0o?)?777\b/i],
];

export function scanDiff(diff) {
  const hits = [];
  let file = null;
  let line = 0;
  for (const text of diff.split('\n')) {
    const to = text.match(/^\+\+\+ (?:b\/)?(.+)$/);
    if (to) {
      file = to[1] === '/dev/null' ? null : to[1];
      // A changed file whose own name is risky is a hit even when its lines aren't.
      if (file && /(^|\/)(\.env[\w.-]*|[\w.-]*\.pem|[\w.-]*\.key|id_(rsa|ed25519)\w*|credentials[\w.]*)$/.test(file)) hits.push({ file, line: 0, text: file, why: 'a secret file' });
      continue;
    }
    const hunk = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!file || text.startsWith('---')) continue;
    if (text.startsWith('+')) {
      const why = RISKY.find(([, re]) => re.test(text.slice(1)))?.[0];
      if (why) hits.push({ file, line, text: text.slice(1).trim(), why });
      line++;
    } else if (!text.startsWith('-') && !text.startsWith('\\')) line++;
  }
  return hits;
}

// The change on card-<n> against the branch it came from, as a unified diff.
export function cardDiff(repo, id, base = 'main') {
  const r = spawnSync('git', ['diff', `${base}...card-${id}`], { cwd: resolve(repo), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git diff ${base}...card-${id}: ${r.stderr.trim()}`);
  return r.stdout;
}

// Milo's review pack (#268): the card's done when, the diff, and each changed file whole
// when it is short or not code, else each changed top-level block whole with line numbers.
// A three-line diff context hid the guard a line above a hunk, so most of his findings were
// "the code he couldn't see handles it". Still no title, plan, build notes or other files.
const WHOLE_LINES = 300;
const NOT_CODE = /\.(md|markdown|json|ya?ml|txt)$/i;
// A top-level block starts at column 0 on a line that isn't blank, a closing bracket or a
// comment; a comment line directly above it belongs to it. Language-blind on purpose.
const COMMENT = /^\s*(\/\/|#|\/\*|\*|--)/;
const starts = (line) => /^[^\s})\]]/.test(line) && !COMMENT.test(line);

// The new side's changed line numbers, from a -U0 diff of one file. A pure deletion marks
// the lines either side of where it was.
function changedLines(diff) {
  const lines = new Set();
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const at = Number(m[1]);
    const count = m[2] == null ? 1 : Number(m[2]);
    if (count) for (let i = 0; i < count; i++) lines.add(at + i);
    else lines.add(Math.max(at, 1)).add(at + 1);
  }
  return [...lines].sort((a, b) => a - b);
}

// The 1-based ranges [a, b] of the top-level blocks holding the changed lines, merged when
// they touch or overlap.
export function blockRanges(lines, changed) {
  const n = lines.length;
  const blockStart = (i) => {
    // i is 0-based; back over comment lines directly above the start.
    while (i > 0 && COMMENT.test(lines[i - 1]) && lines[i - 1].trim()) i--;
    return i;
  };
  const ranges = [];
  for (const line of changed) {
    const at = Math.min(Math.max(line, 1), n) - 1;
    let s = at;
    while (s > 0 && !starts(lines[s])) s--;
    s = starts(lines[s]) ? blockStart(s) : 0;
    let e = at + 1;
    while (e < n && !starts(lines[e])) e++;
    e = e < n ? blockStart(e) : n; // the line before the next block's start, comments and all
    while (e - 1 > at && !lines[e - 1].trim()) e--;
    ranges.push([s + 1, Math.max(e, at + 1)]);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

// A fence longer than any run of backticks in the text, so a Markdown file can't close it.
const fenced = (text) => {
  const ticks = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${ticks}\n${text}${text.endsWith('\n') ? '' : '\n'}${ticks}`;
};

export function reviewPack(repo, id, base = 'main') {
  const root = resolve(repo);
  const card = parseBoard(readFileSync(join(root, 'pm', 'board.md'), 'utf8')).columns.flatMap((c) => c.cards).find((c) => c.id === id);
  if (!card) throw new Error(`#${id} isn't on the board`);
  const doneWhen = card.details.filter((d) => /^done when:/i.test(d));
  if (!doneWhen.length) throw new Error(`#${id} has no done when`);
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`);
    return r.stdout;
  };
  const branch = `card-${id}`;
  const range = `${base}...${branch}`;
  // -z keeps odd file names unquoted; --no-renames shows a move as a deletion and an addition.
  const status = git('diff', '--no-renames', '--name-status', '-z', range).split('\0').filter(Boolean);
  const numstat = git('diff', '--no-renames', '--numstat', '-z', range).split('\0').filter(Boolean);
  const binary = new Set(numstat.filter((l) => l.startsWith('-\t-\t')).map((l) => l.slice(4)));
  const parts = [];
  for (let i = 0; i < status.length; i += 2) {
    const [kind, path] = [status[i], status[i + 1]];
    if (kind === 'D') continue; // a deleted file is only in the diff
    if (binary.has(path)) {
      parts.push(`### ${path} (binary, not shown)`);
      continue;
    }
    const text = git('show', `${branch}:${path}`);
    const lines = text.split('\n');
    if (text.endsWith('\n')) lines.pop();
    if (lines.length <= WHOLE_LINES || NOT_CODE.test(path)) {
      parts.push(`### ${path} (whole file)\n${fenced(text)}`);
      continue;
    }
    const changed = changedLines(git('diff', '-U0', range, '--', path));
    for (const [a, b] of blockRanges(lines, changed)) {
      const width = String(b).length;
      const body = lines.slice(a - 1, b).map((l, k) => `${String(a + k).padStart(width)}  ${l}`).join('\n');
      parts.push(`### ${path} lines ${a}-${b}\n${fenced(`${body}\n`)}`);
    }
  }
  return [
    `## Done when\n\n${doneWhen.join('\n')}`,
    `## The change\n\n${fenced(git('diff', range))}`,
    `## Changed code in full\n\n${parts.join('\n\n') || 'No file left to show: the change only deletes.'}`,
  ].join('\n\n');
}

export const scanText = (id, hits) =>
  hits.length
    ? [`soloagile: #${id}'s change has ${hits.length} line${hits.length === 1 ? '' : 's'} for Rufus:`, ...hits.map((h) => `  ${h.file}:${h.line}  ${h.why}: ${h.text.slice(0, 120)}`)].join('\n')
    : `soloagile: #${id}'s change touches no keys, tokens, .env, logins or permissions: no security list needed`;

// After the user's look (#240). merge: the user said yes, so card-<n> is merged into the
// branch checked out in the main tree, and its copy and branch go. sendBack: the card
// returns to Build, so the files from Build on are removed and the next run resumes there,
// keeping plan.md. drop: the work goes, copy, branch and run files with it.
function gitIn(repo) {
  return (...args) => {
    const r = spawnSync('git', args, { cwd: resolve(repo), encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.stdout).trim()}`);
    return r.stdout.trim();
  };
}

function removeCopy(repo, id, git) {
  const path = join(resolve(repo), '.claude', 'worktrees', `card-${id}`);
  if (existsSync(path)) git('worktree', 'remove', '--force', path);
}

export function mergeCard(repo, id) {
  const git = gitIn(repo);
  const branch = `card-${id}`;
  git('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  const dirty = git('status', '--porcelain').split('\n').filter((l) => l.trim() && !/^.. pm\//.test(l));
  if (dirty.length) throw new Error(`the main tree has uncommitted changes, so nothing was merged:\n${dirty.join('\n')}`);
  const into = git('branch', '--show-current');
  const r = spawnSync('git', ['merge', '--no-ff', '--no-edit', branch], { cwd: resolve(repo), encoding: 'utf8' });
  if (r.status !== 0) {
    spawnSync('git', ['merge', '--abort'], { cwd: resolve(repo) });
    throw new Error(`card-${id} doesn't merge cleanly into ${into}, so the merge was undone; send it back: soloagile fleet sendback ${id}`);
  }
  removeCopy(repo, id, git);
  git('branch', '-d', branch);
  return { into };
}

export function sendBack(repo, id) {
  const dir = runDir(repo, id);
  const gone = STAGE_FILES.slice(1).map(([, f]) => f).concat('security-list.md').filter((f) => existsSync(join(dir, f)));
  for (const f of gone) rmSync(join(dir, f));
  return gone;
}

export function dropRun(repo, id) {
  const git = gitIn(repo);
  removeCopy(repo, id, git);
  if (spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/card-${id}`], { cwd: resolve(repo) }).status === 0) git('branch', '-D', `card-${id}`);
  rmSync(runDir(repo, id), { recursive: true, force: true });
}

// A fleet run's own page (#241): the five files stacked, each under its heading, a missing
// one said as "didn't run". The page server serves .html from pm/docs/ but nothing from
// pm/runs/, so the page is written to pm/docs/run-<n>.html at each page build. The files are
// written by helpers from the code, so they go through the project's safe Markdown.
const RUN_PARTS = [['Plan', 'plan.md'], ['Design', 'design.md', 'No screen in this card, so no design.'], ['Build', 'build.md'], ['Blind review', 'review.md'], ['Verdicts', 'verdicts.md'], ['Security list', 'security-list.md', 'No hits in the scan, so none was needed.'], ['Picture check', 'picture-check.md', 'No screen in this card, so no pictures to check.'], ['Report', 'report.md']];
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function runPageHtml(id, files, toHtml) {
  const parts = RUN_PARTS.map(([heading, file, quiet]) => {
    const text = files[file];
    const body = text != null ? toHtml(text.replace(/^# .*\n+/, '')) : `<p class="none">${quiet && files['report.md'] != null ? quiet : "Didn't run."}</p>`;
    return `<section><h2>${heading}</h2>${body}</section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>#${id} fleet run</title>
<style>
:root { color-scheme: dark; --bg: #0D100D; --surface: #161A15; --line: #2A2E26; --text: #E8E0CE; --muted: #A8A18E; }
@media (prefers-color-scheme: light) { :root { color-scheme: light; --bg: #F5EDE0; --surface: #FBF6EF; --line: #E4D8C4; --text: #1A1210; --muted: #554C40; } }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 24px; margin: 0 0 16px; }
section { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 4px 16px 12px; margin: 0 0 16px; overflow-wrap: anywhere; }
h2 { font-size: 18px; margin: 12px 0 8px; }
h3 { font-size: 16px; }
pre, code { font-size: 14px; }
pre { overflow-x: auto; background: var(--bg); padding: 8px; border-radius: 8px; }
.none { color: var(--muted); }
</style></head>
<body><main>
<h1>Fleet run · #${id}</h1>
${parts}
</main></body></html>
`;
}

// Writes every run's page; returns the card numbers that have one, for the pop-ups.
export function writeRunPages(pmDir, toHtml) {
  const runs = join(pmDir, 'runs');
  if (!existsSync(runs)) return [];
  const ids = [];
  for (const id of readdirSync(runs).filter((d) => /^\d+$/.test(d))) {
    const files = {};
    for (const [, file] of RUN_PARTS) if (existsSync(join(runs, id, file))) files[file] = readFileSync(join(runs, id, file), 'utf8');
    if (!Object.keys(files).length) continue;
    mkdirSync(join(pmDir, 'docs'), { recursive: true });
    writeFileSync(join(pmDir, 'docs', `run-${id}.html`), runPageHtml(id, files, toHtml));
    ids.push(Number(id));
  }
  return ids;
}
