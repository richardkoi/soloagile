// `soloagile card`: adds, moves and notes cards on pm/board.md, so a card is right the first
// time: numbered, with its milestone and points, and in a lane it is ready for. A wrong move
// is refused with the reason and nothing is written. Editing board.md by hand still works;
// `soloagile build` checks it afterwards. Everything here is text in, text out.
import { finishedCards, archivedDetails } from './archive.js';
import { COLUMNS, SCALE, guessText, parseBoard, parseCardLine, parsePlan } from './board.js';

// A move that would leave the board wrong. Its message says what to do instead.
export class Refused extends Error {}
const refuse = (why) => {
  throw new Refused(why);
};

// The short names the command takes for each lane.
const LANES = { ideas: 'Ideas', next: 'Up next', doing: 'Doing', look: 'Needs your look', decision: 'Needs your decision', done: 'Done' };
export const LANE_NAMES = Object.keys(LANES);
const DOING_STAGES = ['design', 'develop', 'test', 'release'];
const OPTION = /^[a-z]\) /;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');

// "- #12 Title · M1 · 3 pts · test · live 2026-10-02", as board.md writes a card.
function cardLine(c) {
  const meta = [c.milestone, c.points !== null && `${c.points} ${c.points === 1 ? 'pt' : 'pts'}`, c.guess != null && guessText(c.guess), c.stage, c.date && [c.date.label, c.date.value].filter(Boolean).join(' ')];
  return `- #${c.id} ${c.title}${meta.filter(Boolean).map((m) => ` · ${m}`).join('')}`;
}

// Where card `id` is: its lane, its parsed line, and the lines it takes up.
function find(lines, id) {
  const at = lines.findIndex((l) => new RegExp(`^- #${id}(?!\\d)`).test(l));
  if (at < 0) return null;
  let end = at + 1;
  while (end < lines.length && /^\s{2,}\S/.test(lines[end])) end++;
  const lane = lines.slice(0, at).findLast((l) => l.startsWith('## '))?.slice(3).trim();
  return { at, end, lane, card: parseCardLine(lines[at].slice(2)), details: lines.slice(at + 1, end) };
}

// Puts a card's lines at the foot of a lane, above the blank line that ends it.
function put(lines, lane, block) {
  const head = lines.findIndex((l) => l.trim() === `## ${lane}`);
  if (head < 0) refuse(`board.md has no "## ${lane}" lane; the six are ${COLUMNS.join(', ')}`);
  let end = lines.findIndex((l, i) => i > head && l.startsWith('## '));
  if (end < 0) end = lines.length;
  while (end - 1 > head && !lines[end - 1].trim()) end--;
  lines.splice(end, 0, ...block);
}

const laneOf = (word) => LANES[word] ?? refuse(`there is no "${word}" lane; use ${LANE_NAMES.slice(0, -1).join(', ')} or ${LANE_NAMES.at(-1)}`);
const numberOf = (word) => (/^#?\d+$/.test(word ?? '') ? Number(String(word).replace('#', '')) : refuse(`"${word ?? ''}" is not a card number; give one such as 12`));

function checkMilestone(planMd, milestone) {
  if (!/^M\d+$/.test(milestone ?? '')) refuse('a card needs a milestone: --milestone M3. Use the closest one in pm/plan.md, or add a milestone for it there first');
  const known = parsePlan(planMd).milestones.map((m) => m.id);
  if (!known.includes(milestone)) refuse(`pm/plan.md has no ${milestone}${known.length ? ` (it has ${known.join(', ')})` : ''}; add the milestone there first`);
}
function checkPoints(points) {
  if (!SCALE.includes(points)) refuse(`a card needs story points: --points ${SCALE.slice(0, -1).join(', ')} or ${SCALE.at(-1)}`);
}

function gone(archiveMd, id) {
  return finishedCards(archiveMd, [String(id)])
    ? `#${id} is finished and off the board; \`soloagile finished ${id}\` prints it. To work on it again, add a new card`
    : `there is no card #${id} on the board`;
}

// soloagile card add "<title>" --milestone M3 --points 3 [--lane next] [--done-when "…"]
//   [--note "…"]… [--option "…"]… [--design]
export function addCard(boardMd, planMd, { title, milestone, points = null, guess = null, lane = 'next', doneWhen, notes = [], options = [], design = false, today }) {
  const column = laneOf(lane);
  if (!title?.trim()) refuse('a card needs a title: soloagile card add "<title>" --milestone M3 --points 3');
  if (column === 'Needs your look' || column === 'Done') refuse(`a new card can't start in ${column}; add it to doing, then move it`);
  checkMilestone(planMd, milestone);
  const question = column === 'Needs your decision' && !design;
  if (question) {
    if (points !== null) refuse('a question has no size, so no points; a design card takes --design and keeps its points');
    if (guess !== null) refuse('a question has no size, so no guess at its build time');
  } else {
    checkPoints(points);
  }
  if (column === 'Needs your decision' && options.length < 2) refuse('a decision card needs its options, the recommended one first and an open one last: --option "…" --option "…"');
  if ((column === 'Up next' || column === 'Doing') && !doneWhen?.trim()) refuse('a card to be built needs its finish line: --done-when "…"');

  const lines = boardMd.split('\n');
  const next = lines.findIndex((l) => /<!--\s*next-id:\s*\d+\s*-->/.test(l));
  if (next < 0) refuse('board.md is missing its <!-- next-id: N --> line');
  const highest = Math.max(0, ...parseBoard(boardMd).columns.flatMap((c) => c.cards.map((k) => k.id ?? 0)));
  const id = Math.max(Number(lines[next].match(/next-id:\s*(\d+)/)[1]), highest + 1);
  lines[next] = lines[next].replace(/next-id:\s*\d+/, `next-id: ${id + 1}`);

  const card = {
    id,
    title: title.trim(),
    milestone,
    points,
    guess,
    stage: column === 'Doing' ? 'develop' : design ? 'design' : null,
    date: column === 'Needs your decision' ? { label: 'asked', value: today } : null,
  };
  const details = [...notes, ...options.map((o, i) => `${String.fromCharCode(97 + i)}) ${o}`), doneWhen?.trim() && `done when: ${doneWhen.trim()}`].filter(Boolean);
  put(lines, column, [cardLine(card), ...details.map((d) => `  ${d}`)]);
  return { board: lines.join('\n'), id, milestone, said: `added #${id} to ${column}` };
}

// soloagile card move <number> <lane> [stage] [--design] [--from <date>]
export function moveCard(boardMd, archiveMd, { id, lane, stage, design = false, from, today }) {
  const column = laneOf(lane);
  const lines = boardMd.split('\n');
  const found = find(lines, id) ?? refuse(gone(archiveMd, id));
  const { card } = found;
  let details = found.details;
  // A card coming back from Done gets its text back from the archive.
  if (found.lane === 'Done' && column !== 'Done' && !details.length) {
    details = (archivedDetails(archiveMd).get(id) ?? []).map((d) => `  ${d}`);
  }
  const has = (test) => details.some((d) => test(d.trim()));
  const fix = `soloagile card set ${id}`;

  if (!card.milestone) refuse(`#${id} has no milestone; give it the closest one in pm/plan.md: ${fix} --milestone M3`);
  if (stage && column !== 'Doing') refuse(`only a Doing card has a stage; "${stage}" can't go on a card in ${column}`);
  if (from && column !== 'Needs your look') refuse('--from is for a look that can\'t happen before a day: soloagile card move 12 look --from 2026-10-20');
  if (design && column !== 'Needs your decision') refuse('--design is for a design waiting in decision: soloagile card move 12 decision --design');
  const sized = () => card.points !== null || refuse(`#${id} has no story points; size it first: ${fix} --points 3`);

  card.stage = null;
  card.date = null;
  if (column === 'Up next') sized();
  if (column === 'Doing') {
    sized();
    if (stage && !DOING_STAGES.includes(stage)) refuse(`"${stage}" is not a stage; use ${DOING_STAGES.slice(0, -1).join(', ')} or ${DOING_STAGES.at(-1)}`);
    card.stage = stage ?? 'develop';
  }
  if (column === 'Needs your look') {
    sized();
    if (!has((d) => d.startsWith('tested:'))) refuse(`#${id} has no "tested:" line; say what was checked first: soloagile card note ${id} "tested: …"`);
    if (from && !isDate(from)) refuse(`--from takes a day as YYYY-MM-DD, not "${from}"`);
    card.date = from ? { label: 'from', value: from } : { label: 'live', value: today };
  }
  if (column === 'Needs your decision') {
    if (design) sized();
    if (details.filter((d) => OPTION.test(d.trim())).length < 2) {
      refuse(`#${id} has no options to choose from; add them first, the recommended one first and an open one last: soloagile card note ${id} "a) …"`);
    }
    card.stage = design ? 'design' : null;
    card.date = { label: 'asked', value: today };
  }
  if (column === 'Done') card.date = { label: null, value: today };

  lines.splice(found.at, found.end - found.at);
  put(lines, column, [cardLine(card), ...details]);
  const where = column === 'Doing' ? `Doing, at ${card.stage}` : card.date?.label ? `${column}, ${card.date.label} ${card.date.value}` : column;
  return { board: lines.join('\n'), column, said: `#${id} is in ${where}` };
}

// soloagile card note <number> "<line>" [--first]
export function noteCard(boardMd, archiveMd, { id, line, first = false }) {
  if (!line?.trim()) refuse('say what to note: soloagile card note 12 "tested: 40 tests pass"');
  const lines = boardMd.split('\n');
  const found = find(lines, id) ?? refuse(gone(archiveMd, id));
  lines.splice(first ? found.at + 1 : found.end, 0, ...line.trim().split('\n').map((l) => `  ${l.trim()}`));
  return { board: lines.join('\n'), column: found.lane, said: `noted on #${id}` };
}

// soloagile card choose <number> <letter>: the user's pick on a question or design card.
// Its a/b/c lines become one "chosen <today>: b) …" line, where the first option was.
// It doesn't move the card; `card move` still does that.
export function chooseCard(boardMd, archiveMd, { id, letter, today }) {
  const lines = boardMd.split('\n');
  const found = find(lines, id) ?? refuse(gone(archiveMd, id));
  const options = found.details.map((d, i) => ({ at: found.at + 1 + i, text: d.trim() })).filter((o) => OPTION.test(o.text));
  if (!options.length) refuse(`#${id} has no options to choose from`);
  const letters = options.map((o) => o.text[0]);
  const listed = letters.length > 1 ? `${letters.slice(0, -1).join(', ')} or ${letters.at(-1)}` : letters[0];
  const pick = options.find((o) => o.text[0] === String(letter ?? '').toLowerCase().replace(/\)$/, ''));
  if (!pick) refuse(`${letter ? `"${letter}" is not one of #${id}'s options` : 'say which option'}; it has ${listed}: soloagile card choose ${id} ${letters[0]}`);
  for (const o of options.toReversed()) lines.splice(o.at, 1);
  lines.splice(options[0].at, 0, `  chosen ${today}: ${pick.text}`);
  return { board: lines.join('\n'), column: found.lane, said: `#${id}: chosen ${pick.text}` };
}

// soloagile card set <number> [--milestone M3] [--points 5] [--guess 40] [--title "…"]
export function setCard(boardMd, planMd, archiveMd, { id, milestone, points, guess, title }) {
  if (milestone === undefined && points === undefined && guess === undefined && title === undefined) refuse('say what to set: --milestone M3, --points 5, --guess 40 or --title "…"');
  const lines = boardMd.split('\n');
  const found = find(lines, id) ?? refuse(gone(archiveMd, id));
  const { card } = found;
  if (milestone !== undefined) {
    checkMilestone(planMd, milestone);
    card.milestone = milestone;
  }
  if (points !== undefined) {
    checkPoints(points);
    card.points = points;
  }
  if (guess !== undefined) card.guess = guess;
  if (title !== undefined) card.title = title.trim() || refuse('a card needs a title');
  lines[found.at] = cardLine(card);
  return { board: lines.join('\n'), column: found.lane, said: `#${id} is now: ${lines[found.at].slice(2)}` };
}

// soloagile card show <number>: the card in full, from the board or from the finished cards.
export function showCard(boardMd, archiveMd, { id }) {
  const lines = boardMd.split('\n');
  const found = find(lines, id);
  if (found && (found.lane !== 'Done' || found.details.length)) return `${found.lane}\n${lines.slice(found.at, found.end).join('\n')}\n`;
  const kept = finishedCards(archiveMd, [String(id)]);
  if (kept) return `Done\n${kept}`;
  return found ? `${found.lane}\n${lines[found.at]}\n` : refuse(`there is no card #${id}`);
}

// The command line after "soloagile card": a verb, then words and --flags in any order.
// Returns { verb, args } with every flag by name; --note and --option may repeat.
const FLAGS = { '--milestone': 'milestone', '-m': 'milestone', '--points': 'points', '-p': 'points', '--lane': 'lane', '--done-when': 'doneWhen', '--note': 'notes', '--option': 'options', '--from': 'from', '--title': 'title', '--guess': 'guess' };
const SWITCHES = { '--design': 'design', '--first': 'first' };
export function parseCardArgs(argv) {
  const [verb, ...rest] = argv;
  const args = { words: [], notes: [], options: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (SWITCHES[a]) args[SWITCHES[a]] = true;
    else if (FLAGS[a]) {
      const value = rest[++i] ?? refuse(`${a} needs something after it`);
      if (Array.isArray(args[FLAGS[a]])) args[FLAGS[a]].push(value);
      else args[FLAGS[a]] = value;
    } else if (a.startsWith('--')) refuse(`there is no ${a} here; see \`soloagile help\``);
    else args.words.push(a);
  }
  if (args.points !== undefined) args.points = /^\d+$/.test(args.points) ? Number(args.points) : refuse(`--points takes a number: ${SCALE.join(', ')}`);
  if (args.guess !== undefined) args.guess = minutesOf(args.guess) ?? refuse('--guess takes a time: 40, "40 min" or "1.5h"');
  return { verb, args };
}

// "40", "40m", "40 min", "1.5h", "2 h" -> minutes; anything else -> null.
function minutesOf(text) {
  const m = String(text).trim().match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes|h|hr|hrs|hours)?$/);
  return m && Number(m[1]) > 0 ? Number(m[1]) * (/^h/.test(m[2] ?? '') ? 60 : 1) : null;
}

export const CARD_USAGE = `soloagile card, run in the project's folder:
  soloagile card add "<title>" --milestone M3 --points 3 --done-when "…"   a new card, in Up next
      --lane ideas|next|doing|decision   another lane; an idea needs no --done-when
      --guess 40                         a guessed build time in minutes, or "1.5h"
      --note "…"                         a detail line; any number
      --option "…" --option "…"          for --lane decision: its options, lettered for you
      --design                           for --lane decision: a design waiting for a yes
  soloagile card move <number> ideas|next|doing|look|decision|done
      doing design|develop|test|release  a Doing card's stage; also changes it
      look --from 2026-10-20             a look that can't happen before that day
      decision --design                  a design waiting for a yes
  soloagile card note <number> "<line>" [--first]   add a detail line, such as "tested: …"
  soloagile card choose <number> <letter>           the user's pick: its options become one "chosen" line
  soloagile card set <number> [--milestone M3] [--points 5] [--guess 40] [--title "…"]
  soloagile card show <number>                      the card in full, finished or not`;

// Runs one command against the files' text. Returns { board, said, column } for a change,
// or { print } for `show`.
// How many cards a milestone holds, on the board and finished, each counted once.
export function milestoneCount(boardMd, archiveMd, milestone) {
  const ids = new Set();
  for (const md of [boardMd, archiveMd ?? '']) {
    for (const line of md.split('\n')) {
      if (!/^- #\d+ /.test(line)) continue;
      const c = parseCardLine(line.slice(2));
      if (c.milestone === milestone) ids.add(c.id);
    }
  }
  return ids.size;
}

// A milestone holds about this many cards at most (the milestone-size habit).
export const MILESTONE_CARDS = 15;

export function runCard(argv, { board, plan, archive, today }) {
  const { verb, args } = parseCardArgs(argv);
  const [first, second, third] = args.words;
  if (verb === 'add') return addCard(board, plan, { ...args, title: first, today });
  if (verb === 'move') return moveCard(board, archive, { ...args, id: numberOf(first), lane: second ?? refuse('say which lane: soloagile card move 12 doing'), stage: third, today });
  if (verb === 'note') return noteCard(board, archive, { id: numberOf(first), line: second, first: args.first });
  if (verb === 'choose') return chooseCard(board, archive, { id: numberOf(first), letter: second, today });
  if (verb === 'set') return setCard(board, plan, archive, { ...args, id: numberOf(first) });
  if (verb === 'show') return { print: showCard(board, archive, { id: numberOf(first) }) };
  return refuse(verb ? `there is no "card ${verb}"` : 'say what to do with a card');
}
