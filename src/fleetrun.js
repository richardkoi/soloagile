// soloagile fleet run <n> (#299): a card's fleet in its own `claude -p` session, so the
// session that asked for it carries none of the run's turns and gets back a short summary.
// The run's tokens also land in a session file of their own, which `fleet cost` reads.
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { runDir } from './fleet.js';

export const SUMMARY_LINES = 20;
// "auto" lets the run's Bash commands (soloagile, git, the checks) go ahead unattended while
// its classifier still blocks risky ones; acceptEdits would deny every Bash command not on an
// allow list, and bypassPermissions checks nothing.
export const DEFAULT_MODE = 'auto';

// The command line for the inner session: the fleet skill as the prompt, the whole stream
// of its turns as JSON lines, so session.log holds the run and its final message.
export const fleetArgs = (id, mode = DEFAULT_MODE) => ['-p', `/soloagile:fleet ${id}`, '--permission-mode', mode, '--output-format', 'stream-json', '--verbose'];

// The session's final message: the last stream-json "result" line's text, or, from a claude
// that printed plain text, the log itself.
export function finalMessage(log) {
  let text = null;
  for (const line of log.split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const e = JSON.parse(line);
      if (e.type === 'result' && typeof e.result === 'string') text = e.result;
    } catch {}
  }
  return (text ?? log).trim();
}

// At most `max` lines: the head of report.md (a short checklist by now, #300) and where the
// branch, report and log are; with no report, the last lines of the final message.
export function summary(id, { report, message, status, log }) {
  const where = `branch: card-${id} · report: pm/runs/${id}/report.md · log: ${log}`;
  if (report) {
    const head = `soloagile: #${id}'s fleet run ${status === 0 ? 'ended' : `failed (exit ${status})`}; its report:`;
    const lines = report.split('\n').filter((l) => l.trim());
    return [head, ...lines.slice(0, SUMMARY_LINES - 2), where].join('\n');
  }
  const head = `soloagile: #${id}'s fleet run left no report (exit ${status}); the end of its last message:`;
  const lines = message.split('\n').filter((l) => l.trim());
  return [head, ...lines.slice(-(SUMMARY_LINES - 2)), `log: ${log}`].join('\n');
}

// Runs the card's fleet in the project at root and returns { status, text }: status is 0 only
// when the inner run exits 0 and writes report.md during this run (an older one doesn't count).
export function runFleet(root, id, { mode = DEFAULT_MODE, claude = process.env.SOLOAGILE_CLAUDE || 'claude', now = Date.now() } = {}) {
  const dir = runDir(root, id);
  mkdirSync(dir, { recursive: true });
  const logFile = join(dir, 'session.log');
  const fd = openSync(logFile, 'w');
  let r;
  try {
    r = spawnSync(claude, fleetArgs(id, mode), { cwd: resolve(root), stdio: ['ignore', fd, fd], env: { ...process.env, SOLOAGILE_FLEET_INNER: '1' } });
  } finally {
    closeSync(fd);
  }
  const log = relative(resolve(root), logFile);
  if (r.error) return { status: 1, text: `soloagile: #${id}'s fleet run didn't start: ${r.error.message}` };
  const reportFile = join(dir, 'report.md');
  // mtime is kept to the second on some filesystems, so allow a second's slack
  const fresh = existsSync(reportFile) && statSync(reportFile).mtimeMs >= now - 1000;
  const report = fresh ? readFileSync(reportFile, 'utf8') : null;
  const status = r.status ?? 1;
  return { status: status === 0 && report ? 0 : 1, text: summary(id, { report, message: finalMessage(readFileSync(logFile, 'utf8')), status, log }) };
}
