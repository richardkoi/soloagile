// The build fleet's preflight (#233): Ada's checks before a fleet run, a lock so one card
// runs once at a time, and the stage a run starts or resumes at. A run's files live in
// pm/runs/<card>/; the lock is pm/runs/<card>/lock, holding the pid and start time.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseBoard } from './board.js';

// Each stage leaves one file; a run resumes at the first one missing. The security list is
// written only when the script finds something (#238), so it isn't a stage of its own here.
export const STAGE_FILES = [['plan', 'plan.md'], ['build', 'build.md'], ['review', 'review.md'], ['verdicts', 'verdicts.md'], ['test', 'report.md']];

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

// Refuses with the reason, or locks the card and says where the run starts.
// Returns { stage, file, cleared } where cleared is a stale lock that was removed.
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
  mkdirSync(dir, { recursive: true });
  writeFileSync(lockFile, `${JSON.stringify({ pid, started: now.toISOString() })}\n`);
  const next = STAGE_FILES.find(([, file]) => !existsSync(join(dir, file)));
  return { stage: next ? next[0] : 'done', file: next ? next[1] : null, cleared };
}

export function unlock(repo, id) {
  const lockFile = join(runDir(repo, id), 'lock');
  const was = existsSync(lockFile);
  rmSync(lockFile, { force: true });
  return was;
}

export function preflightText(id, { stage, file, cleared }) {
  return [
    cleared && `soloagile: cleared #${id}'s old lock (pid ${cleared.pid}, from ${cleared.started}): that run had stopped`,
    `soloagile: #${id} is locked for its fleet run`,
    stage === 'done' ? `soloagile: every stage file is there; the run is at its end` : `soloagile: start at ${stage}: pm/runs/${id}/${file} isn't written yet`,
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
