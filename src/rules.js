// Standing rules (#144): a retro's agreed changes, kept as numbered rules in a
// "## Standing rules" section of the project's CLAUDE.md, each tagged with where it came
// from. CLAUDE.md is loaded into every session, so a rule keeps working after the retro.
//   soloagile rule "<the rule>" --from "retro of M14, #129"
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HEADING = '## Standing rules';
const INTRO = 'Lessons from retros, kept by `soloagile rule`. Each says where it came from.';

// The CLAUDE.md text with the rule added as the next number. The section is made at the
// end when missing; a rule already there word for word is not added twice.
export function addRule(md, text, from) {
  text = text.trim().replace(/\s+/g, ' ');
  if (!text) throw new Error('a rule needs its words: soloagile rule "<the rule>" --from "retro of M3, #12"');
  const lines = md.split('\n');
  let at = lines.findIndex((l) => l.trim() === HEADING);
  if (at < 0) {
    while (lines.length && lines.at(-1).trim() === '') lines.pop();
    lines.push(...(lines.length ? [''] : []), HEADING, '', INTRO, '');
    at = lines.length - 4;
  }
  let end = lines.findIndex((l, i) => i > at && /^#{1,2} /.test(l));
  if (end < 0) end = lines.length;
  const numbers = lines.slice(at, end).map((l) => Number(l.match(/^(\d+)\. /)?.[1])).filter(Boolean);
  if (lines.slice(at, end).some((l) => l.replace(/^\d+\. /, '').startsWith(text))) return { md, number: null };
  const number = numbers.length ? Math.max(...numbers) + 1 : 1;
  // The new rule goes after the section's last non-blank line.
  let last = end - 1;
  while (last > at && lines[last].trim() === '') last--;
  const rule = `${number}. ${text}${from ? ` (From ${from.trim().replace(/^from /i, '')}.)` : ''}`;
  lines.splice(last + 1, 0, ...(numbers.length ? [rule] : ['', rule])); // the first rule sits a line below the intro
  return { md: `${lines.join('\n').replace(/\n*$/, '')}\n`, number };
}

export function addRuleTo(repo, text, from) {
  const file = join(resolve(repo), 'CLAUDE.md');
  const { md, number } = addRule(existsSync(file) ? readFileSync(file, 'utf8') : '', text, from);
  writeFileSync(file, md);
  return { file, number };
}
