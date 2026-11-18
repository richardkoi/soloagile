// The build fleet's preflight (#233): Ada's checks before a fleet run, a lock so one card
// runs once at a time, and the stage a run starts or resumes at. A run's files live in
// pm/runs/<card>/; the lock is pm/runs/<card>/lock, holding the pid and start time.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readArchive } from './archive.js';
import { parseBoard } from './board.js';
import { moveCard } from './card.js';
import { localDate } from './init.js';
import { readUsage } from './usage.js';

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

// What a run cost (#271). TokenSentinel gives each window's used share, so a run's cost is
// the end reading minus the one at its start. The start is kept in pm/runs/<n>/usage-start.json
// as { at, pcts, resetAt }, or { at, said } when there were no numbers. A resumed run keeps a
// start with numbers; a start with none (or one that can't be read) gives way to a later one
// that has them, and keeps the failed one's time as replaced. resetAt is each window's reset
// time, from usageResets.
export async function recordUsageStart(repo, id, usage, { now = new Date() } = {}) {
  const file = join(runDir(repo, id), 'usage-start.json');
  const u = usage ?? (await readUsage());
  const numbers = u.pcts && Object.keys(u.pcts).length;
  let old = null;
  if (existsSync(file)) {
    try { old = JSON.parse(readFileSync(file, 'utf8')); } catch {}
    if (!numbers || (old?.pcts && Object.keys(old.pcts).length)) return false;
  }
  let start = { at: now.toISOString(), said: u.said };
  if (numbers) {
    start = { at: now.toISOString(), pcts: u.pcts };
    if (typeof old?.at === 'string') start.replaced = old.at;
    if (u.resets && Object.keys(u.resets).length) {
      start.resetAt = Object.fromEntries(Object.entries(u.resets).map(([n, min]) => [n, new Date(now.getTime() + min * 60000).toISOString()]));
    }
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(start)}\n`);
  return true;
}

// The report's ## Cost section. start and end are { pcts } or { said }; now is the end's
// time. The share always has one decimal (0.6%, 7.0%); the readings are shown as given,
// trimmed to one decimal against float noise (4% → 4.6%). A window lower at the end than at
// the start, or whose reset time (start.resetAt) had come by now, reset during the run, so
// its share is unknown; a minute's grace after resetAt allows for the reading's rounding to
// whole minutes. A window with no resetAt says its reset wasn't checked. A start that replaced
// a failed one (start.replaced) says when each was read, as ISO times.
// others: cards whose runs overlapped, whose cost is in the same numbers.
export function costLines(start, end, { others = [], now = new Date() } = {}) {
  const lines = ['## Cost'];
  const has = (u) => u?.pcts && Object.keys(u.pcts).length;
  const reading = (x) => String(Math.round(x * 10) / 10);
  if (!has(start) || !has(end)) lines.push(`- not measured: ${(!has(start) ? start?.said : end?.said) || 'no usage numbers'}`);
  else {
    for (const [name, from] of Object.entries(start.pcts)) {
      const to = end.pcts[name];
      const resetAt = Date.parse(start.resetAt?.[name]);
      const unchecked = Number.isFinite(resetAt) ? '' : " (reset not checked: usageResets isn't set)";
      if (to == null) lines.push(`- the ${name}: not measured, no reading at the end`);
      else if (!Number.isFinite(from) || !Number.isFinite(to)) lines.push(`- the ${name}: not measured, the reading isn't a number`);
      else if (to < from || now.getTime() >= resetAt + 60000) lines.push(`- the ${name}: not measured, it reset during the run`);
      else lines.push(`- the ${name}: ${(to - from).toFixed(1)}% of the limit (${reading(from)}% → ${reading(to)}%)${unchecked}`);
    }
    if (start.replaced) lines.push(`- measured from ${start.at}; the first reading at ${start.replaced} failed`);
  }
  if (others.length) lines.push(`- shared with ${others.map((n) => `#${n}`).join(', ')}: their runs ran at the same time, so this counts them too`);
  return lines.join('\n');
}

// The cost of card id's run up to now: usage is the end reading (readUsage's result). Another
// run overlapped when it started (its usage-start.json or lock) before now and either started
// inside this run, still holds a lock whose pid is alive, or wrote its report.md after this
// run's start. A lock left by a dead process says nothing about now.
export async function runCost(repo, id, { usage, now = new Date(), isAlive = alive } = {}) {
  const file = join(runDir(repo, id), 'usage-start.json');
  let start = { said: "no usage was recorded at the run's start" };
  if (existsSync(file)) {
    try { start = JSON.parse(readFileSync(file, 'utf8')); } catch { start = null; }
    if (!start || typeof start !== 'object') start = { said: "the start reading couldn't be read" };
  }
  const end = usage ?? (await readUsage());
  const others = [];
  const runs = join(resolve(repo), 'pm', 'runs');
  const from = Date.parse(start.at);
  if (Number.isFinite(from) && existsSync(runs)) {
    for (const m of readdirSync(runs).filter((d) => /^\d+$/.test(d) && Number(d) !== id).sort((a, b) => a - b)) {
      const dir = join(runs, m);
      const times = [];
      let held = false;
      try { times.push(Date.parse(JSON.parse(readFileSync(join(dir, 'usage-start.json'), 'utf8')).at)); } catch {}
      try {
        const lock = JSON.parse(readFileSync(join(dir, 'lock'), 'utf8'));
        times.push(Date.parse(lock.started));
        held = isAlive(lock.pid);
      } catch {}
      const began = Math.min(...times.filter(Number.isFinite));
      if (!(began <= now.getTime())) continue;
      let reported = false;
      try { reported = statSync(join(dir, 'report.md')).mtimeMs > from; } catch {}
      if (began >= from || held || reported) others.push(Number(m));
    }
  }
  return costLines(start, end, { others, now });
}

// Tobin's own copy of the code (#235): a git worktree on branch card-<n>, under
// .claude/worktrees/ where soloagile cleanup clears merged ones. That folder is added to
// the repo's own .git/info/exclude, never to a committed file, so the copy doesn't make the
// main tree look dirty to the next preflight. A second call finds the copy already there.
// from: a new branch card-<n> is made from it (not HEAD), and it is kept in git config as
// branch.card-<n>.fleetBase so the scan compares against it (#269). Only a branch made here
// is recorded; a later call never rewrites it. The CLI's --from flag is #270's job.
export function fleetBranch(repo, id, { from } = {}) {
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
  else {
    git('worktree', 'add', '-b', branch, path, ...(from ? [from] : []));
    if (from) git('config', `branch.${branch}.fleetBase`, from);
  }
  return { path, branch, made: true };
}

// The security scan (#238): a plain search of a change's added lines for keys, tokens, .env,
// logins and permissions. No hits, and Rufus is never started, so a quiet change costs
// nothing. Each hit is { file, line, text, why }, line being the new file's line number.
// An entry whose third item is true is key material itself: it is checked on every added
// line, comments and prose too (#269). The rest are words, checked in code only. The token
// and login words treat _ as a separator, not a letter (#275), so NPM_AUTH_TOKEN, GITHUB_TOKEN
// and .npmrc's :_auth= and :_password= hit, while tokens or author do not.
const RISKY = [
  ['a key or token', /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(ghp|gho|github_pat|sk|xox[abp])[-_][A-Za-z0-9_]{10,}|\bnpm_[A-Za-z0-9]{36}\b/i, true],
  ['a key or token', /(?<![A-Za-z0-9])(api[_-]?key|_?auth[_-]?token|secret|token|bearer|private[_-]?key|client[_-]?secret|access[_-]?key)(?![A-Za-z0-9])/i],
  ['a .env file', /(^|[^\w.])\.env\b|\bprocess\.env\b|\bos\.environ\b|\bdotenv\b/],
  // Not session (#269): the word is all over this plugin's prose and tests ("Session flow").
  ['a login or password', /(?<![A-Za-z0-9])(password|passwd|login|auth|cookie|credential|oauth|jwt)(?![A-Za-z0-9])/i],
  ['a permission', /\b(chmod\w*|chown\w*|sudo|setuid|permissions?|allow(ed)?[-_ ]?tools|cors|access[-_ ]control)\b|\b(0o?)?777\b/i],
];

// Only code is scanned for the words (#269): comments and Markdown prose talk about tokens
// and logins without holding any. Comment syntax goes by file type: // and /* */ in the
// SLASH files, # (not #!) in the HASH files, <!-- --> in the HTML files. Any other file
// (.json, .txt, dotfiles like .npmrc, where // starts a real line) has no comments: every
// line is scanned. Only a line that is wholly a comment is skipped, or one inside a comment
// opened above; code after a closing */ or --> is scanned. A trailing # or // comment is cut
// only outside quotes (#275), so a # or // inside a string keeps the rest of the line, and
// // after a : (a URL) is code. In Markdown only fenced code is
// scanned. State is followed through added and context lines; the CLI scan reads the whole
// file as context, so a fence or comment opened far above is known. An extensionless file
// (bin/soloagile, a Dockerfile) is a HASH file unless its shebang, on line 1, runs node,
// deno or bun, which makes it a SLASH file.
const SLASH = /\.(js|mjs|cjs|ts|tsx|jsx|css|scss|c|h|cpp|go|rs|java|kt|swift)$/;
const HASH = /\.(sh|bash|zsh|py|rb|ya?ml|toml)$/;
const HTML = /\.(html?|xml|svg|vue)$/;
const JS_SHEBANG = /^#!.*\b(node|deno|bun)\b/;
const MARKDOWN = /\.(md|markdown)$/i;
const BLOCK = { slash: ['/*', '*/'], html: ['<!--', '-->'] };

// slash, hash, html, or null for a file with no comment syntax known.
function syntax(file, st) {
  const name = file.slice(file.lastIndexOf('/') + 1);
  if (SLASH.test(name)) return 'slash';
  if (HASH.test(name) || /^(Dockerfile|Makefile)$/.test(name)) return 'hash';
  if (HTML.test(name)) return 'html';
  if (!name.includes('.')) return JS_SHEBANG.test(st.shebang ?? '') ? 'slash' : 'hash';
  return null;
}

// The part of a line to scan, or null for none; st carries the open fence or comment and
// the file's shebang.
function codePart(file, body, st) {
  const t = body.trim();
  if (MARKDOWN.test(file)) {
    const fence = t.match(/^(`{3,}|~{3,})/);
    if (fence && (!st.fence || fence[1][0] === st.fence[0])) {
      st.fence = st.fence ? null : fence[1];
      return null;
    }
    return st.fence ? body : null;
  }
  const lang = syntax(file, st);
  if (!lang) return body;
  // Inside a comment, or one opening the line: skip to its close, then scan what follows.
  const [opener, closer] = BLOCK[lang] ?? [];
  if (st.open || (opener && t.startsWith(opener))) {
    const start = st.open ? 0 : body.indexOf(opener) + opener.length;
    const end = body.indexOf(closer, start);
    st.open = end < 0;
    return end < 0 ? null : codePart(file, body.slice(end + closer.length), st);
  }
  if (lang === 'slash' && t.startsWith('//')) return null;
  if (lang === 'hash' && t.startsWith('#') && !t.startsWith('#!')) return null;
  return lang === 'html' ? body : cutTrailing(body, lang);
}

// A line with its trailing comment cut off (#275). The walk follows '…', "…" and `…`
// strings, with backslash escapes, so a # or // inside one is not a comment. In a hash file
// a # is a comment only at the start or after whitespace ($# and a#b are code, and so is a
// #! opening the line); in a slash file // is a comment unless it follows a : (a URL like
// http://x is code).
function cutTrailing(body, lang) {
  let quote = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (lang === 'hash' && c === '#' && (i === 0 || /\s/.test(body[i - 1])) && !(body[i + 1] === '!' && !body.slice(0, i).trim())) return body.slice(0, i);
    if (lang === 'slash' && c === '/' && body[i + 1] === '/' && body[i - 1] !== ':') return body.slice(0, i);
  }
  return body;
}

export function scanDiff(diff) {
  const hits = [];
  let file = null;
  let line = 0;
  let st = {};
  for (const text of diff.split('\n')) {
    const to = text.match(/^\+\+\+ (?:b\/)?(.+)$/);
    if (to) {
      file = to[1] === '/dev/null' ? null : to[1];
      // A changed file whose own name is risky is a hit even when its lines aren't.
      if (file && /(^|\/)(\.env[\w.-]*|[\w.-]*\.pem|[\w.-]*\.key|id_(rsa|ed25519)\w*|credentials[\w.]*)$/.test(file)) hits.push({ file, line: 0, text: file, why: 'a secret file' });
      st = {};
      continue;
    }
    const hunk = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      line = Number(hunk[1]);
      st = { shebang: st.shebang };
      continue;
    }
    if (!file || text.startsWith('---')) continue;
    const added = text.startsWith('+');
    if (!added && (text.startsWith('-') || text.startsWith('\\'))) continue;
    const body = text.slice(1);
    if (line === 1 && body.startsWith('#!')) st.shebang = body;
    const code = codePart(file, body, st);
    if (added) {
      const why = RISKY.find(([, re, everywhere]) => (everywhere ? body : code) && re.test(everywhere ? body : code))?.[0];
      if (why) hits.push({ file, line, text: body.trim(), why });
    }
    line++;
  }
  return hits;
}

// The branch card-<n> was built on (#269): branch.card-<n>.fleetBase in git config when
// set and still there, otherwise the branch checked out in the main tree (the first
// worktree listed). A stored base that is gone (merged and deleted) falls back the same way.
export function cardBase(repo, id) {
  const cwd = resolve(repo);
  const set = spawnSync('git', ['config', '--get', `branch.card-${id}.fleetBase`], { cwd, encoding: 'utf8' });
  const stored = set.status === 0 ? set.stdout.trim() : '';
  if (stored && spawnSync('git', ['rev-parse', '--verify', '--quiet', `${stored}^{commit}`], { cwd }).status === 0) return stored;
  const list = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' }).stdout ?? '';
  return list.split('\n\n')[0].match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? 'main';
}

// The change on card-<n> against the branch it came from, as a unified diff. context: 'all'
// gives each changed file whole as context (the scan's view, so a fence, comment or shebang
// far from the change is known); otherwise git's usual 3 lines.
// maxBuffer is there for the tests: a small one makes the whole-file diff overflow.
export function cardDiff(repo, id, base = cardBase(repo, id), { context, maxBuffer = 64 * 1024 * 1024 } = {}) {
  const wide = context === 'all' ? ['-U1000000'] : [];
  const r = spawnSync('git', ['diff', ...wide, `${base}...card-${id}`], { cwd: resolve(repo), encoding: 'utf8', maxBuffer });
  // An overflow can come back with status 0 and the output cut short, so error is checked too.
  if (r.error || r.status !== 0) throw new Error(`git diff ${base}...card-${id}: ${r.error?.message ?? r.stderr.trim()}`);
  return r.stdout;
}

// Milo's review pack (#268): the card's done when, the diff, and each changed file whole
// when it is short or not code, else each changed top-level block whole with line numbers.
// A three-line diff context hid the guard a line above a hunk, so most of his findings were
// "the code he couldn't see handles it". Still no title, plan, build notes or other files:
// files under the top-level pm/ (the board, run notes) are left out entirely, named only.
const WHOLE_LINES = 300;
const NOT_CODE = /\.(md|markdown|json|ya?ml|txt)$/i;
// A code file over 300 lines or 60 KB gives its changed blocks whole, whatever their size; a
// non-code one gives its changed regions with this many lines either side. Over 120 KB in
// all, the pack drops the code in full for the diff alone; when even the diff is over 120 KB,
// it gives each file's --stat line instead, and says the change is too big for a blind review.
const AROUND = 20;
const REGIONS_ONLY = 60 * 1024;
const PACK_MAX = 120 * 1024;
// A top-level block starts at column 0 on a line that isn't blank, a closing bracket, a
// closing keyword (shell's fi, done and esac, Ruby's and Lua's end), a comment or a decorator.
// Comment and @decorator lines at column 0 directly above a start belong to it, as do a
// /** comment's " * " lines; an indented comment belongs to the body it sits in.
// Language-blind on purpose.
const CLOSER = /^(?:fi|done|esac|end)\b(?!\s*=(?!=))/;
const attaches = (line) => /^(?:\/\/|#|\/\*|--|@| \*)/.test(line);
const starts = (line) => /^[^\s})\]]/.test(line) && !CLOSER.test(line) && !attaches(line);

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

// Sorts 1-based ranges [a, b] and merges those that touch or overlap.
const mergeRanges = (ranges) => {
  const merged = [];
  for (const r of ranges.sort((x, y) => x[0] - y[0])) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
};

// The 1-based ranges [a, b] of the top-level blocks holding the changed lines, merged when
// they touch or overlap.
export function blockRanges(lines, changed) {
  const n = lines.length;
  const blockStart = (i) => {
    // i is 0-based; back over comment and decorator lines directly above the start.
    while (i > 0 && attaches(lines[i - 1])) i--;
    return i;
  };
  const ranges = [];
  for (const line of changed) {
    let at = Math.min(Math.max(line, 1), n) - 1;
    // A changed comment or decorator line directly above a block start belongs to that block.
    let below = at;
    while (below < n && attaches(lines[below])) below++;
    if (below > at && below < n && starts(lines[below])) at = below;
    let s = at;
    while (s > 0 && !starts(lines[s])) s--;
    s = starts(lines[s]) ? blockStart(s) : 0;
    let e = at + 1;
    while (e < n && !starts(lines[e])) e++;
    e = e < n ? blockStart(e) : n; // the line before the next block's start, comments and all
    while (e - 1 > at && !lines[e - 1].trim()) e--;
    ranges.push([s + 1, Math.max(e, at + 1)]);
  }
  return mergeRanges(ranges);
}

// The 1-based ranges [a, b] of each changed line with AROUND lines either side, merged.
const regionRanges = (n, changed) =>
  mergeRanges(changed.map((l) => [Math.max(1, l - AROUND), Math.min(n, l + AROUND)]));

// A fence longer than any run of backticks in the text, so a Markdown file can't close it.
// A loop, not a spread into Math.max: a long file can have more runs than a call takes.
const fenced = (text) => {
  let longest = 2;
  for (const m of text.matchAll(/`+/g)) if (m[0].length > longest) longest = m[0].length;
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}\n${text}${text.endsWith('\n') ? '' : '\n'}${ticks}`;
};

// base: the branch card-<n> was built on, as the scan uses (cardBase, #269), not a fixed 'main'.
export function reviewPack(repo, id, base = cardBase(repo, id)) {
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
  const notPm = ['--', '.', ':(exclude)pm/']; // only the top-level pm/, from the repo's root
  // --raw gives each entry's modes ("…:100644 100755 <old> <new> M", then its path); -z
  // keeps odd file names unquoted; --no-renames shows a move as a deletion and an addition.
  const raw = git('diff', '--no-renames', '--raw', '-z', range).split('\0').filter(Boolean);
  // numstat -z: "<added>\t<deleted>\t<path>"; "-\t-" for a binary file.
  const counts = new Map(git('diff', '--no-renames', '--numstat', '-z', range).split('\0').filter(Boolean).map((l) => {
    const [added, deleted, ...path] = l.split('\t');
    return [path.join('\t'), `${added}\t${deleted}`];
  }));
  const parts = [];
  let deleted = 0;
  const underPm = [];
  for (let i = 0; i < raw.length; i += 2) {
    const [, newMode, , , kind] = raw[i].split(' ');
    const path = raw[i + 1];
    if (path.startsWith('pm/')) {
      underPm.push(path); // the board and run notes, deleted or not: named, never shown
      continue;
    }
    if (kind === 'D') {
      deleted++; // a deleted file is only in the diff
      continue;
    }
    if (newMode === '160000') {
      parts.push(`### ${path} (submodule, not shown)`);
      continue;
    }
    const count = counts.get(path);
    if (count === '-\t-') {
      parts.push(`### ${path} (binary, not shown)`);
      continue;
    }
    if (kind !== 'A' && count === '0\t0') {
      parts.push(`### ${path} (mode change only)`);
      continue;
    }
    let text;
    try {
      text = git('show', `${branch}:${path}`);
    } catch {
      parts.push(`### ${path} (git show can't print it, not shown)`);
      continue;
    }
    const lines = text.split('\n');
    if (text.endsWith('\n')) lines.pop();
    const big = Buffer.byteLength(text) > REGIONS_ONLY;
    if (!big && lines.length <= WHOLE_LINES) {
      parts.push(`### ${path} (whole file)\n${fenced(text)}`);
      continue;
    }
    const changed = changedLines(git('diff', '-U0', range, '--', path));
    const ranges = NOT_CODE.test(path) ? regionRanges(lines.length, changed) : blockRanges(lines, changed);
    for (const [a, b] of ranges) {
      const width = String(b).length;
      const body = lines.slice(a - 1, b).map((l, k) => `${String(a + k).padStart(width)}  ${l}`).join('\n');
      parts.push(`### ${path} lines ${a}-${b}\n${fenced(`${body}\n`)}`);
    }
  }
  // An empty part says which of the two reasons holds (a binary, submodule or mode change
  // is listed by name, so only deleted files and files under pm/ leave nothing to show).
  const none = deleted && underPm.length
    ? 'None: the change only deletes files, which are in the diff alone, and touches files under pm/, which are left out of the pack.'
    : underPm.length
      ? 'None: the change only touches files under pm/, which are left out of the pack.'
      : deleted
        ? 'None: the change only deletes files, so they are in the diff alone.'
        : 'None: the change has no files.';
  const kb = (bytes) => Math.round(bytes / 1024);
  const doneWhenPart = `## Done when\n\n${doneWhen.join('\n')}`;
  const leftOut = underPm.length ? [`Left out of the pack: ${underPm.join(', ')}`] : [];
  const head = [doneWhenPart, `## The change\n\n${fenced(git('diff', range, ...notPm))}`];
  let pack;
  if (Buffer.byteLength(head.join('\n\n')) > PACK_MAX) {
    // Even the diff is too big: each file's stat line, and a note for Orla's report.
    const stat = git('diff', '--stat=1000', range, ...notPm);
    const note = `Too big for a blind review: the done when and the diff alone would be ${kb(Buffer.byteLength(head.join('\n\n')))} KB, over 120 KB, so here is each changed file's line from git diff --stat.`;
    pack = [doneWhenPart, `## The change\n\n${note}\n\n${fenced(stat)}`, ...leftOut].join('\n\n');
  } else {
    pack = [...head, ...leftOut, `## Changed code in full\n\n${parts.join('\n\n') || none}`].join('\n\n');
    if (Buffer.byteLength(pack) > PACK_MAX) {
      const note = `Left out: with the changed code in full the pack would be ${kb(Buffer.byteLength(pack))} KB, over 120 KB, so Milo has the diff alone.`;
      pack = [...head, ...leftOut, `## Changed code in full\n\n${note}`].join('\n\n');
    }
  }
  const bytes = Buffer.byteLength(pack);
  return `${pack}\n\nSize: ${bytes} bytes (${kb(bytes)} KB) above this line.`;
}

// The CLI scan (#269): the whole-file diff, or, when that fails (too big for maxBuffer),
// git's plain 3-line diff, with narrow: true so the scan's first line says so.
export function scanCard(repo, id, base = cardBase(repo, id), { maxBuffer } = {}) {
  try {
    return { hits: scanDiff(cardDiff(repo, id, base, { context: 'all', maxBuffer })), narrow: false };
  } catch {
    return { hits: scanDiff(cardDiff(repo, id, base)), narrow: true };
  }
}

// base, when given, is named in the first line: the branch the change was compared against.
// narrow: the scan read the 3-line diff, not whole files, which the first line says too.
export const scanText = (id, hits, base, { narrow } = {}) => {
  const change = `soloagile: #${id}'s change${base ? ` against ${base}` : ''}${narrow ? ' (read as a 3-line diff: the whole-file diff failed, so a comment or fence opened far above may be missed)' : ''}`;
  return hits.length
    ? [`${change} has ${hits.length} line${hits.length === 1 ? '' : 's'} for Rufus:`, ...hits.map((h) => `  ${h.file}:${h.line}  ${h.why}: ${h.text.slice(0, 120)}`)].join('\n')
    : `${change} touches no keys, tokens, .env, logins or permissions: no security list needed`;
};

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
  const into = baseBranch(git);
  // A branch reviewed before main moved (cards run side by side) would bring an unreviewed
  // merge into main here, so it goes back through fleet update and review first (#267).
  if (spawnSync('git', ['merge-base', '--is-ancestor', into, branch], { cwd: resolve(repo) }).status !== 0) {
    throw new Error(`${branch} doesn't have ${into}'s latest, so nothing was merged; run soloagile fleet update ${id}, have Tobin resolve any clash, and have the merge reviewed before merging`);
  }
  const r = spawnSync('git', ['merge', '--no-ff', '--no-edit', branch], { cwd: resolve(repo), encoding: 'utf8' });
  if (r.status !== 0) {
    spawnSync('git', ['merge', '--abort'], { cwd: resolve(repo) });
    throw new Error(`card-${id} doesn't merge cleanly into ${into}, so the merge was undone; send it back: soloagile fleet sendback ${id}`);
  }
  removeCopy(repo, id, git);
  git('branch', '-d', branch);
  return { into };
}

// The branch checked out in the main tree, which a card merges into; a detached HEAD has none.
function baseBranch(git) {
  const base = git('branch', '--show-current');
  if (!base) throw new Error("the main tree isn't on a branch, so there is nothing to bring the card up to date with or merge it into; check out main first");
  return base;
}

// A clash git leaves in a file: at column 0 and in order, a line starting <<<<<<< , a later
// line that is ======= alone, and a later line starting >>>>>>> . A lone ======= (a setext
// heading) doesn't count.
const MARKER = /^<<<<<<< [^\n]*\n(?:[^\n]*\n)*?=======\r?\n(?:[^\n]*\n)*?>>>>>>> /m;

// Before Milo's review (#267): card-<n> is brought up to date with the branch checked out in
// the main tree, by a merge inside its copy, so the diff he reads is the change as it will
// merge. A clash is left mid-merge in the copy for Tobin to resolve there; a call while that
// merge is unfinished reports its files again rather than starting another, or 'resolved'
// once every file is staged but the merge isn't committed. A branch whose changed files
// still hold conflict markers is refused, so a half-resolved clash never reaches review.
// Returns { state: 'current' | 'merged' | 'resolved', base, path } or { state: 'clash', base, path, files }.
export function updateBranch(repo, id) {
  const branch = `card-${id}`;
  if (spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: resolve(repo) }).status !== 0) {
    throw new Error(`there's no branch ${branch}, so there is nothing to update`);
  }
  const base = baseBranch(gitIn(repo));
  const { path } = fleetBranch(repo, id);
  const git = gitIn(path);
  const clashing = () => git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
  if (spawnSync('git', ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { cwd: path }).status === 0) {
    const files = clashing();
    return files.length ? { state: 'clash', base, path, files } : { state: 'resolved', base, path };
  }
  const dirty = git('status', '--porcelain').split('\n').filter((l) => l.trim());
  if (dirty.length) throw new Error(`${branch}'s copy has uncommitted changes, so it wasn't updated:\n${dirty.join('\n')}`);
  const level = (state) => {
    // -z keeps odd names (café.js) unquoted; only regular files are read, not a symlink or directory.
    const marked = git('diff', '-z', '--name-only', `${base}...HEAD`).split('\0').filter(Boolean)
      .filter((f) => existsSync(join(path, f)) && lstatSync(join(path, f)).isFile()
        && MARKER.test(readFileSync(join(path, f), 'utf8')));
    if (marked.length) throw new Error(`${branch} still has conflict markers in these files, so it isn't ready for review; resolve them in ${path} and commit:\n${marked.join('\n')}`);
    return { state, base, path };
  };
  if (spawnSync('git', ['merge-base', '--is-ancestor', base, 'HEAD'], { cwd: path }).status === 0) return level('current');
  const r = spawnSync('git', ['merge', '--no-edit', base], { cwd: path, encoding: 'utf8' });
  if (r.status === 0) return level('merged');
  const files = clashing();
  if (!files.length) throw new Error(`git merge ${base} in ${path}: ${(r.stderr || r.stdout).trim()}`);
  return { state: 'clash', base, path, files };
}

export const updateText = (id, { state, base, path, files }) =>
  state === 'current'
    ? `soloagile: card-${id} is already up to date with ${base}`
    : state === 'merged'
      ? `soloagile: brought card-${id} up to date with ${base}; no clash`
      : state === 'resolved'
        ? `soloagile: card-${id}'s merge with ${base} is resolved but not committed; commit the merge in ${path}, then run fleet update again`
        : [`soloagile: card-${id} clashes with ${base} in ${files.length} file(s), left mid-merge in ${path} for Tobin:`, ...files.map((f) => `  ${f}`)].join('\n');

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
