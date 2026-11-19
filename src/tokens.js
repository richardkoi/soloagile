// A card's tokens, counted from Claude Code's own logs (#286). The usage percentages are
// whole numbers at their source, so a short build reads 0 or 1%; tokens are exact. Asking
// TokenSentinel for a project's total took 24 s on weatherglider, too slow for every card
// move, so this reads only the log files touched since the card started, and only their
// lines inside its time. It counts the way TokenSentinel and ccusage do: input + output +
// cache writes + cache reads, each assistant message once (the last line for its message id
// and request id, since a message streams partial usage first).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Claude Code names a project's log folder after its path, every other character a dash.
export const projectSlug = (root) => resolve(root).replace(/[^A-Za-z0-9]/g, '-');

const defaultDir = () => process.env.SOLOAGILE_CLAUDE_PROJECTS || join(homedir(), '.claude', 'projects');

function* jsonlFiles(dir, since) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isDirectory()) yield* jsonlFiles(path, since);
    else if (e.name.endsWith('.jsonl')) {
      try { if (statSync(path).mtimeMs >= since) yield path; } catch {}
    }
  }
}

// Tokens the project used between from and to (ms), its fleet copies (.claude/worktrees/…)
// and helpers' subagent logs included. null when the project has no log folder at all.
export function projectTokens(root, from, to, { projectsDir = defaultDir() } = {}) {
  const slug = projectSlug(root);
  let dirs;
  try {
    dirs = readdirSync(projectsDir).filter((d) => d === slug || d.startsWith(`${slug}--claude-worktrees-`));
  } catch { return null; }
  if (!dirs.includes(slug)) return null;
  const msgs = new Map();
  let anon = 0;
  for (const d of dirs) {
    for (const file of jsonlFiles(join(projectsDir, d), from)) {
      let text = '';
      try { text = readFileSync(file, 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line.includes('"usage"')) continue;
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        const u = rec?.type === 'assistant' ? rec.message?.usage : null;
        if (!u || typeof u !== 'object') continue;
        const at = Date.parse(rec.timestamp);
        if (!(at >= from && at <= to)) continue;
        const key = rec.message.id || rec.requestId ? `${rec.message.id ?? ''}|${rec.requestId ?? ''}` : `#${anon++}`;
        msgs.set(key, ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
          .reduce((sum, k) => sum + (Number(u[k]) || 0), 0));
      }
    }
  }
  let total = 0;
  for (const n of msgs.values()) total += n;
  return total;
}

// 12 · 1.2k · 57k · 1.2M · 2.5B
export function formatTokens(n) {
  const short = (x, unit) => `${x < 10 ? Math.round(x * 10) / 10 : Math.round(x)}${unit}`;
  if (n < 1000) return String(n);
  if (n < 1e6) return short(n / 1e3, 'k');
  if (n < 1e9) return short(n / 1e6, 'M');
  return short(n / 1e9, 'B');
}
