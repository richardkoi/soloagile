// Habits: ways of working that can be switched on or off, for all projects in
// ~/.soloagile/settings.json or for one project in pm/settings.json, both under "habits".
// One project's switch beats all projects', and a habit nobody switched is on.
// The page's Settings tab shows them; `soloagile set` changes them; the session start
// tells Claude the built ones, so a change takes effect at the next session.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { icon } from './icons.js';
import { ownDir, readSettings } from './settings.js';

// card: the card that builds the habit. rule: what Claude is told when it is on. A habit
// with no rule isn't built yet: the tab shows it as coming, and Claude isn't told.
export const HABITS = [
  { key: 'away-mode', name: 'Away mode', what: 'When you say you are away, Claude asks its questions first, then works through Up next.', card: 139,
    rule: 'When the user says they are going away (bed, lunch, out), run /soloagile:away: every waiting question first, then build Up next until it is empty or the week reaches its stop.' },
  { key: 'busy-while-waiting', name: 'Start a card while something slow runs', what: 'During a long test or build, Claude starts a card that can’t disturb it.', card: 140,
    rule: "While a long test, build, render or deploy runs in the background, start the next card that can't disturb it, without being asked. Never end a turn just to say you're waiting." },
  { key: 'picture-pages', name: 'A page of pictures per card', what: 'Every card waiting for your look has its own page of pictures.', card: 141,
    rule: "Before a card with pictures goes to Needs your look, give it its own page: soloagile pictures <card> <files…> --caption \"…\" (or --url <address> for a page's four pictures). The card's pop-up links it." },
  { key: 'picture-scripts', name: 'Pictures from a kept script', what: 'A card’s pictures can be taken again from a script kept in the project.', card: 142,
    rule: "Make a card's pictures through soloagile pictures, with --by \"<command>\" when a script makes them, so soloagile retake <card> takes them again after a change. The card's tested: line names pm/takes/card-<n>.sh." },
  { key: 'feedback-cards', name: 'What you mention becomes a card', what: 'After you try something, each thing you mention gets a card.', card: 143,
    rule: 'After the user tries something (a page, a build, a device), ask what they saw. Each thing they mention gets its own card in the same sitting, with points and a milestone, before other work.' },
  { key: 'retro-rules', name: 'Retro lessons become standing rules', what: 'A retro writes each agreed change as a numbered rule in the project’s CLAUDE.md.', card: 144,
    rule: 'In a retro, each change the user picks also becomes a standing rule in the project\'s CLAUDE.md: soloagile rule "<the rule, said as what to do>" --from "retro of M3, #12".' },
  { key: 'parallel-helpers', name: 'Helpers build cards in parallel', what: 'Several helpers build cards at once, each in its own copy of the code.', card: 145,
    rule: 'For a run of Up next cards that touch different files, offer /soloagile:parallel: one helper per card, each in its own worktree, merged back by you.' },
  { key: 'weekly-cleanup', name: 'Weekly clean-up and day-end backup', what: 'Old copies and pictures are cleared weekly; “done for today” runs the backup.', card: 146,
    rule: "At 'done for today', run soloagile backup: it runs the project's backup command when pm/settings.json names one. A session start clears old copies and pictures once a week by itself; soloagile cleanup --dry-run shows what would go." },
  { key: 'milestone-size', name: 'About 15 cards per milestone', what: 'soloagile card add warns when a milestone passes 15 cards.', card: 147,
    rule: 'A milestone holds about 15 cards at most. When one would pass that, propose a new milestone for the rest; soloagile card add warns when it happens.' },
  { key: 'question-batches', name: 'Questions in batches', what: 'Waiting questions are asked together, up to four at a time.', card: 148,
    rule: 'Ask waiting questions together in one round, up to four to a call, each multiple choice with the recommended option first and an open answer last. Gather the questions before starting work, not one at a time between steps.' },
];

const projectFile = (repo) => join(resolve(repo), 'pm', 'settings.json');
const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {});

// Each habit with on (true or false) and from: 'default', 'all projects' or 'this project'.
// Is one habit on for this project? For the code that acts on a habit, such as card add.
export const habitOn = (repo, key) => habitStates(repo).find((h) => h.key === key)?.on ?? true;

export function habitStates(repo, { habits = HABITS, settings = readSettings() } = {}) {
  const all = settings.habits ?? {};
  const mine = repo ? (readJson(projectFile(repo)).habits ?? {}) : {};
  return habits.map((h) =>
    h.key in mine ? { ...h, on: mine[h.key] !== false, from: 'this project' }
    : h.key in all ? { ...h, on: all[h.key] !== false, from: 'all projects' }
    : { ...h, on: true, from: 'default' },
  );
}

// Switches a habit for one project (repo), or for all projects (repo null). Returns the habit.
export function setHabit(repo, key, on, habits = HABITS) {
  const habit = habits.find((h) => h.key === key);
  if (!habit) throw new Error(`there is no habit called "${key}". The habits: ${habits.map((h) => h.key).join(', ')}`);
  const file = repo ? projectFile(repo) : join(ownDir(), 'settings.json');
  const json = readJson(file);
  json.habits = { ...json.habits, [key]: on };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  return habit;
}

// What the session start tells Claude: the built habits, on or off. '' when none is built.
export function habitsText(states) {
  const built = states.filter((h) => h.rule);
  if (!built.length) return '';
  return [
    "Habits, from soloagile's settings:",
    ...built.map((h) => `- ${h.name}: ${h.on ? `on. ${h.rule}` : "off. Don't do it."}`),
  ].join('\n');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FROM = { default: 'on unless switched off', 'all projects': 'set for all projects', 'this project': 'set for this project' };

// The Settings tab: read-only. A habit is changed by telling Claude, or with the command shown.
export function renderSettings(states) {
  if (!states.length) return '<p class="empty">No settings yet.</p>';
  const row = (h) => {
    const state = h.rule ? `<span class="habit-state ${h.on ? 'on' : 'off'}">${h.on ? 'on' : 'off'}</span>` : '<span class="habit-state soon">coming</span>';
    const how = h.rule
      ? `<p class="habit-how">${FROM[h.from]} · <code>soloagile set ${esc(h.key)} ${h.on ? 'off' : 'on'}</code></p>`
      : `<p class="habit-how">coming with #${h.card} · <code>soloagile set ${esc(h.key)} ${h.on ? 'off' : 'on'}</code> switches it ahead of time</p>`;
    return `<li class="habit"><div class="habit-top"><h3 class="habit-name">${esc(h.name)}</h3>${state}</div><p class="habit-what">${esc(h.what)}</p>${how}</li>`;
  };
  return `<h2 class="settings-title">${icon('sliders-horizontal')}Settings</h2>
<p class="habit-intro">Read-only. Tell Claude “turn away mode off”, or run the command shown. Add <code>--all</code> to change it for every project. A change takes effect at the next session.</p>
<ul class="habits">${states.map(row).join('')}</ul>`;
}
