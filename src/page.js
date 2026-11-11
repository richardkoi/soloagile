// Turns a project's pm/*.md text into the finished page HTML (no file I/O here,
// so tests can render without touching disk).
import { learningReport } from './learning.js';
import { batchFrom, batchText, cardsLeft, shares } from './guess.js';
import { Marked, marked } from '../vendor/marked.esm.js';
import { archivedDetails, doneCutoff } from './archive.js';
import { COLUMNS, SCALE, SHORT_LINE, STAGES, guessText, isDesign, isLater, msClass, parseBoard, parsePlan, stageOf } from './board.js';
import { icon } from './icons.js';
import { parseHistory } from './history.js';
import { renderSettings } from './habits.js';
import { buildTimes, duration, renderReports } from './reports.js';
import { VERSION } from './version.js';

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// The page shows a project's own Markdown, and a cloned repo's pm/ folder is someone
// else's writing. So raw HTML shows as text, never as tags that run or load something, and
// a link with a scheme goes only to a web, mail or file address; a javascript: one is plain text.
// soloagile's own files, such as template/flow.md, are trusted and go through `marked` as
// written (trustedBlock).
const LINK_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const projectMd = new Marked({
  renderer: {
    html: ({ text }) => esc(text),
    link(token) {
      return LINK_SCHEME.test(token.href) && !/^(https?|mailto|file):/i.test(token.href) ? this.parser.parseInline(token.tokens) : false;
    },
  },
});
export const inline = (s) => projectMd.parseInline(s);
// Each file opens with its own "# Heading"; the tab already names it.
const stripTitle = (s) => s.replace(/^# .*\n+/, '');
// Web links open in a new tab so the page stays put behind them.
const newTab = (html) => html.replace(/<a href="(https?:)/g, '<a target="_blank" rel="noopener" href="$1');
export const block = (s) => newTab(projectMd.parse(stripTitle(s)));
export const trustedBlock = (s) => newTab(marked.parse(stripTitle(s)));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "2026-09-30" -> "30 Sep"; with a label, "built" -> "Built 30 Sep".
export function shortDate(date) {
  if (!date) return '';
  const [, m, d] = date.value.split('-').map(Number);
  const day = `${d} ${MONTHS[m - 1]}`;
  return date.label ? `${date.label[0].toUpperCase()}${date.label.slice(1)} ${day}` : day;
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const stamp = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;

// ---------- board ----------

// Lanes follow the My Board pattern: five in a row, one coloured rail. They
// regroup board.md's six columns; decisions and looks share "Waiting on you".
// This is the order a phone stacks them in. Five in a row, the CSS puts them in flow
// order instead: Ideas, Up next, Doing, Waiting on you, Done (template/head.html).
const LANES = [
  { name: 'Waiting on you', hint: 'your look or answer', empty: 'Nothing waiting on you', key: 'waiting', icon: 'bell-ring', from: ['Needs your decision', 'Needs your look'] },
  { name: 'Doing', hint: 'Claude is on it', empty: "Claude isn't building anything", key: 'doing', icon: 'hammer', from: ['Doing'] },
  { name: 'Up next', hint: 'queued', empty: 'Nothing queued', key: 'up-next', icon: 'list-todo', from: ['Up next'] },
  { name: 'Ideas', hint: 'not planned yet', empty: 'No ideas yet', key: 'ideas', icon: 'lightbulb', from: ['Ideas'] },
  { name: 'Done', hint: 'last 48 hours', empty: 'Nothing finished in the last 48 hours', key: 'done', icon: 'circle-check', from: ['Done'] },
];
export const KIND = {
  'Needs your decision': { label: 'Decide', pill: 'st-hold', icon: 'circle-help' },
  'Needs your look': { label: 'Look', pill: 'st-look', icon: 'eye' },
};
// A design waiting for the user's yes sits with the decisions, under its own name.
const DESIGN = { label: 'Design', pill: 'st-hold', icon: 'pencil-ruler', tone: 'decide' };
// The pill a waiting card wears: Decide, Design or Look.
export const kindOf = (card, column) => (isDesign(card, column) ? DESIGN : KIND[column]);
// A look that can't happen yet (isLater): shown last in Waiting on you, dimmed and uncounted.
const LATER = { label: 'Later', pill: 'st-quiet', icon: 'clock' };
const kindPill = (k) => `<span class="st ${k.pill}">${icon(k.icon)}${k.label}</span>`;
// A milestone's name, in its own colour wherever the page names it: as a tag, or as plain text.
const withMs = (cls, id) => [cls, msClass(id)].filter(Boolean).join(' ');
// With a short name from the plan ("M9 Public plugin"), the chip says what the milestone is.
const shortName = (short) => (short ? `<span class="ms-short">${esc(short)}</span>` : '');
// A long name may be cut short on a card's face, so the whole of it is also its hover tip.
const milestoneTag = (id, short) => `<span class="${withMs('tag tag-proj', id)}"${short ? ` title="${esc(id)} ${esc(short)}"` : ''}>${icon('flag')}${esc(id)}${shortName(short)}</span>`;
export const milestoneInk = (id) => `<b class="${withMs('ms-ink', id)}">${esc(id)}</b>`;
// The size chip sits at the right of the card's foot: the story points, and the guessed
// build time after a rule when the card has one. The pts-<n> class colours the chip, from
// green at 1 to red at 13.
const sizeTag = (n, guess) =>
  `<span class="tag pts pts-${n}">${n} ${n === 1 ? 'pt' : 'pts'}${guess != null ? `<span class="guess" title="Guessed build time">${guessText(guess)}</span>` : ''}</span>`;

// The wheel: six blocks, filled up to the card's stage, with the stage's name beside them.
function stageBar(stage, name = `${stage[0].toUpperCase()}${stage.slice(1)}`) {
  const at = STAGES.indexOf(stage) + 1;
  const blocks = STAGES.map((_, i) => (i < at ? '<i class="on"></i>' : '<i></i>')).join('');
  return `<p class="stage" title="Stage ${at} of ${STAGES.length}"><span class="stage-bar" aria-hidden="true">${blocks}</span>${name}</p>`;
}

// A decision card's options are the detail lines that start "a) ", "b) " and so on.
const OPTION = /^[a-z]\) /;
// The card's face carries one brief line: the first detail line that isn't an option,
// or else a count of the options. Every line is in the card's modal.
function summaryOf(details) {
  const line = details.find((d) => !OPTION.test(d));
  if (line) return inline(line);
  return details.length === 1 ? '1 option' : `${details.length} options`;
}

// An option's picture, taken by `soloagile design`, goes under that option in the card's modal.
// It is a link to itself: a click opens it full size in a new tab (template/refresh.html).
// A "chosen <date>: b) …" line, left by `soloagile card choose`, keeps option b's picture,
// so the card shows what was picked until the user's yes on its look (#106).
const CHOSEN = /^chosen [\d-]+: ([a-z])\) /;
const letterOf = (line) => (OPTION.test(line) ? line[0] : line.match(CHOSEN)?.[1]);
const pictureOf = (card, line, pictures) => { const l = letterOf(line); return l && pictures[`${card.id}-${l}`]; };
function optionPicture(card, line, pictures) {
  const pic = pictureOf(card, line, pictures);
  return pic ? `<a class="pic-open" href="${pic.src}" target="_blank" title="Open full size in a new tab"><img class="option-pic" src="${pic.src}" width="${pic.width}" height="${pic.height}" alt="Option ${letterOf(line)}, as a picture" loading="lazy"></a>` : '';
}

// A photo icon in the card's top row, with how many pictures are inside, so the user knows
// to open it.
function picturesTag(card, pictures) {
  const n = card.details.filter((d) => pictureOf(card, d, pictures)).length + (pictures[`card-${card.id}`]?.count ?? 0);
  return n ? `<span class="tag tag-pics" title="${n} ${n === 1 ? 'picture' : 'pictures'} inside">${icon('image')}${n}</span>` : '';
}

// A card with its own page of pictures (soloagile pictures) links it, in a new tab.
function picturePage(card, pictures) {
  const page = pictures[`card-${card.id}`];
  return page ? `<a class="pic-page" href="designs/card-${card.id}/index.html" target="_blank">${icon('image')}Open its picture page (${page.count})</a>` : '';
}

// How long a card has waited on the user, as a note after its date: "waiting 6 days". It
// counts from the card's own date (`live`, `asked`, or a `from` day that has come), so a
// card with no date has none. The page's script counts again when the page is opened
// (template/refresh.html), because a quiet project's page may be days old.
const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00`) - new Date(`${from}T00:00`)) / 86400000);
export function ageNote(card, column, today) {
  if (!KIND[column] || !card.date || isLater(card, column, today)) return '';
  const days = daysBetween(card.date.value, today);
  if (days < 0) return '';
  return `<span class="age" data-since="${card.date.value}">${days ? `waiting ${days} day${days === 1 ? '' : 's'}` : 'since today'}</span>`;
}

// laneKey picks the card's colour; decisions and looks get their own within Waiting on you.
// A card with detail lines opens them in a modal: its title becomes a button that the CSS
// stretches over the whole card, and the browser's Popover API opens and closes the modal
// (modalId is its id), so no script is needed.
// shorts: each milestone's short name, by id (parsePlan).
function renderCard(c, column, laneKey, modalId, later, pictures, today, shorts) {
  // Ideas and Up next are all at Plan, so their bar would say nothing; it shows from Doing on (#222).
  const stage = stageOf(c, column);
  const wheel = stage && stage !== 'plan' ? stageBar(stage) : '';
  const kind = later ? LATER : kindOf(c, column);
  const tone = kind ? (kind.tone ?? kind.label.toLowerCase()) : laneKey;
  // The head: what kind of wait, whose milestone, and the number at the right. The photo
  // icon is on the card's face only: in the modal the pictures are in view.
  const topWith = (pics) => [
    kind ? kindPill(kind) : '',
    c.milestone ? milestoneTag(c.milestone, shorts[c.milestone]) : '',
    pics,
    c.id !== null ? `<span class="card-id">#${c.id}</span>` : '',
  ].join('');
  const top = topWith('');
  const title = inline(c.title);
  let meta = c.date ? `<p class="card-meta">${icon('calendar')}${esc(shortDate(c.date))}${ageNote(c, column, today)}</p>` : '';
  // The foot: how far along on the left, how big on the right. A card with no stage, such
  // as a Done card, puts its date there instead, so the chip doesn't take a row alone.
  // A built card says its guess on the took line below, so the chip doesn't say it again (#223).
  const built = c.guess != null && c.took != null;
  const size = c.points !== null ? sizeTag(c.points, built ? null : c.guess) : '';
  const left = wheel || (size ? meta : '');
  const foot = left || size ? `<div class="card-foot">${left}${size}</div>` : '';
  if (left === meta) meta = '';
  // Once built, a guessed card says how close the guess came, under its foot.
  const tookLine = built ? `<p class="card-took">guessed ${duration(c.guess)}, took ${duration(c.took)}</p>` : '';
  // The range a guess came with (#208) shows in the pop-up only; the chip keeps the middle (#207, Rich's pick b).
  const rangeLine = c.range ? `<p class="card-range">likely ${c.range[0]}–${c.range[1]} min (6 in 10 cards like it land here)</p>` : '';
  // data-ms and data-later are for the milestone filter, data-id for the search box (template/refresh.html).
  const li = `<li class="card-x card-${tone}" data-ms="${esc(c.milestone ?? '')}"${c.id !== null ? ` data-id="${c.id}"` : ''}${later ? ' data-later' : ''}>`;
  if (!c.details.length) {
    return `${li}<div class="card-top">${top}</div><p class="card-title">${title}</p>${meta}${foot}${tookLine}${picturePage(c, pictures)}</li>`;
  }
  const open = `<button class="card-open" type="button" popovertarget="${modalId}">${title}</button>`;
  const close = `<button class="modal-close" type="button" popovertarget="${modalId}" popovertargetaction="hide" aria-label="Close">${icon('x')}</button>`;
  const lines = c.details.map((d) => `<li>${newTab(inline(d))}${optionPicture(c, d, pictures)}</li>`).join('');
  const modal = `<div class="card-modal" id="${modalId}" popover role="dialog" aria-labelledby="${modalId}-h"><div class="card-top">${top}${close}</div><h2 class="modal-title" id="${modalId}-h">${title}</h2>${meta}${foot}${rangeLine}${tookLine}${picturePage(c, pictures)}<ul class="modal-body">${lines}</ul></div>`;
  return `${li}<div class="card-top">${topWith(picturesTag(c, pictures))}</div><p class="card-title">${open}</p><p class="card-note">${summaryOf(c.details)}</p>${meta}${foot}${tookLine}${modal}</li>`;
}

// Lanes that fold, and the way their arrow points: towards the board's edge.
const FOLDS = { ideas: 'chevron-left', done: 'chevron-right' };
// batchOf: n -> a batch's guess for n cards (src/guess.js), or null; Up next shows it (#209).
function renderLane(lane, cards, pictures, today, shorts, batchOf = () => null) {
  const body = cards.length
    ? `<ul class="lane-body">${cards.map(({ card, column, later }, i) => renderCard(card, column, lane.key, `card-${lane.key}-${i}`, later, pictures, today, shorts)).join('\n')}</ul>`
    : `<p class="lane-empty">${esc(lane.empty ?? 'No cards')}</p>`; // in words, not a dash (#226)
  // The lane's count and its total points (#133) leave out looks that can't happen yet.
  const shown = cards.filter((c) => !c.later);
  const points = shown.reduce((sum, { card }) => sum + (card.points ?? 0), 0);
  // Ideas and Done can fold to a thin strip (#134); template/refresh.html remembers it.
  const guess = lane.key === 'up-next' && shown.length ? batchOf(shown.length) : null;
  // The page's script adds when it would end, "(by 16:30)", from the time it is opened.
  const batch = guess ? `<span class="lane-batch" data-likely="${guess.likely}" data-surely="${guess.surely}">${esc(batchText(guess))}</span>` : '';
  const fold = FOLDS[lane.key] ? `<button type="button" class="lane-fold" aria-expanded="true" aria-label="Fold ${esc(lane.name)} to a strip" title="Fold or unfold">${icon(FOLDS[lane.key])}</button>` : '';
  return `<section class="lane lane-${lane.key}" aria-label="${esc(lane.name)}">
<div class="lane-head"><span class="lane-icon">${icon(lane.icon)}</span><span class="lane-name">${esc(lane.name)}</span><span class="lane-count">${shown.length}</span>${points ? `<span class="lane-points">${points} ${points === 1 ? 'pt' : 'pts'}</span>` : ''}${batch}${lane.hint ? `<span class="lane-hint">${esc(lane.hint)}</span>` : ''}${fold}</div>
${body}
</section>`;
}

// Done shows the last 48 hours (doneCutoff, src/archive.js). Older cards are hidden here
// until `soloagile archive` takes them off board.md; a card with no date always shows.
function recentlyDone(builtAt) {
  const cutoff = doneCutoff(ymd(builtAt));
  return ({ card, column }) => column !== 'Done' || !card.date || card.date.value >= cutoff;
}

// The search box above the lanes (#132): words light the cards that match and dim the rest;
// a card's number and Enter opens it. The finding is done by template/refresh.html.
const FIND_BOX = '<div class="card-find"><input type="search" placeholder="Find a card: words, or #12 and Enter" aria-label="Find a card" autocomplete="off"><span class="card-find-note" aria-live="polite"></span></div>';

// The milestone menu beside the search box (#217): All, then each milestone that has an open
// card on the board, in plan order. A milestone whose cards are all Done leaves it at once,
// though its cards stay under Done for their 48 hours (#183). Picking one shows only that
// milestone's cards; the page's script does it and remembers the pick (template/refresh.html).
// One milestone or none needs no menu.
function renderFilter(cards, shorts) {
  const present = new Set(cards.filter(({ column }) => column !== 'Done').map(({ card }) => card.milestone).filter(Boolean));
  const order = [...Object.keys(shorts), ...[...present].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))];
  const ids = [...new Set(order)].filter((id) => present.has(id));
  if (ids.length < 2) return '';
  const option = (id) => `<option value="${esc(id)}">${esc(id)}${shorts[id] ? ` ${esc(shorts[id])}` : ''}</option>`;
  return `<label class="ms-filter"><span class="ms-filter-label">Milestone</span><select aria-label="Show one milestone's cards"><option value="">All</option>${ids.map(option).join('')}</select></label>`;
}

// A Done card is one line on the board. Its detail lines are in the archive, so it still
// opens in full. `finished` is that archive's text.
// took: card number -> minutes it spent being built, from the history (buildTimes).
function renderBoard(board, builtAt, pictures, finished = '', shorts = {}, took = new Map(), batchOf = () => null) {
  const today = ymd(builtAt);
  const kept = finished ? archivedDetails(finished) : new Map();
  const full = (card, column) => (column === 'Done' && !card.details.length && kept.has(card.id) ? { ...card, details: kept.get(card.id) } : card);
  const inFull = (card, column) => ({ ...full(card, column), took: took.get(card.id) ?? null });
  const cardsOf = (names) =>
    names
      .flatMap((column) => (board.columns.find((c) => c.name === column)?.cards ?? []).map((card) => ({ card: inFull(card, column), column, later: isLater(card, column, today) })))
      .filter(recentlyDone(builtAt))
      .sort((a, b) => a.later - b.later); // looks for later go last; the sort keeps every other order
  // Columns with unexpected names (already reported as problems) still show, as extra lanes.
  const extra = board.columns
    .filter((c) => !COLUMNS.includes(c.name))
    .map((c) => ({ name: c.name, hint: '', key: slug(c.name), icon: 'circle', from: [c.name] }));
  const lanes = [...LANES, ...extra];
  return {
    html: lanes.map((lane) => renderLane(lane, cardsOf(lane.from), pictures, today, shorts, batchOf)).join('\n'),
    filter: `<div class="board-tools">${FIND_BOX}${renderFilter(lanes.flatMap((lane) => cardsOf(lane.from)), shorts)}</div>`,
    waiting: cardsOf(LANES[0].from).filter((c) => !c.later).length,
  };
}

const swatches = ['decide', 'look', 'doing', 'up-next', 'ideas', 'done'].map((t) => `<i class="card-${t}"></i>`).join('');
const pointSwatches = SCALE.map((n) => `<i class="pts pts-${n}"></i>`).join('');
const KEY = `<section class="key" aria-labelledby="key-h">
<h2 class="key-h" id="key-h">Key</h2>
<div class="key-cols">
<div class="key-row"><span>${kindPill(KIND['Needs your decision'])}</span><span class="key-name">Decision</span><span class="key-def">Needs your answer. Click the card for the options.</span></div>
<div class="key-row"><span>${kindPill(DESIGN)}</span><span class="key-name">Design</span><span class="key-def">An approach to approve before Claude builds it.</span></div>
<div class="key-row"><span>${kindPill(KIND['Needs your look'])}</span><span class="key-name">Look</span><span class="key-def">Live. Needs you to check it.</span></div>
<div class="key-row"><span>${kindPill(LATER)}</span><span class="key-name">Later</span><span class="key-def">A look that can't happen until its date. Not counted as waiting.</span></div>
<div class="key-row"><span class="key-hues" aria-hidden="true">${swatches}</span><span class="key-name">Card colour</span><span class="key-def">Shows the lane: amber decide, pink look, orange doing, blue up next, purple ideas, green done.</span></div>
<div class="key-row"><span>${milestoneTag('M1')}</span><span class="key-name">Milestone</span><span class="key-def">The plan milestone the card belongs to.</span></div>
<div class="key-row"><span><span class="tag tag-pics">${icon('image')}2</span></span><span class="key-name">Pictures</span><span class="key-def">Pictures inside. Click one to see it full size.</span></div>
<div class="key-row"><span class="key-hues" aria-hidden="true">${pointSwatches}</span><span class="key-name">Points</span><span class="key-def">Claude's quick guess at the card's size, from green (1, tiny) to red (13, too big).</span></div>
<div class="key-row"><span>${stageBar('develop', '')}</span><span class="key-name">Stage</span><span class="key-def">How far round the wheel: Plan, Design, Develop, Test, Release, Feedback. Shown once a card is under way; Ideas and Up next are all at Plan.</span></div>
<div class="key-row"><span class="card-id">#7</span><span class="key-name">Card number</span><span class="key-def">Answer with it, e.g. "#7 yes".</span></div>
<div class="key-row"><span class="card-id">&hellip;</span><span class="key-name">Short line</span><span class="key-def">Click the card for its full description.</span></div>
</div>
</section>`;

// ---------- header ----------

const TABS = [
  ['board', 'Board', 'square-kanban'],
  ['plan', 'Plan', 'map'],
  ['reports', 'Reports', 'chart-line'],
  ['releases', 'Releases', 'rocket'],
  ['docs', 'Docs', 'book-open'],
  ['links', 'Links', 'link'],
  ['settings', 'Settings', 'sliders-horizontal'],
];

function renderNav(waiting) {
  const badge = waiting ? `<span class="badge" aria-label="${waiting} waiting on you">${waiting}</span>` : '';
  return TABS.map(([id, label, ic]) => `<a href="#${id}">${icon(ic)}${label}${id === 'board' ? badge : ''}</a>`).join('');
}

const STATUS = {
  done: { tone: 'st-go', icon: 'check', label: 'Done' },
  'in progress': { tone: 'st-open', icon: 'circle-dot', label: 'In progress' },
  'not started': { tone: 'st-quiet', icon: 'circle', label: 'Not started' },
};
// The milestone in hand is the one whose cards are moving: Doing decides it, then the
// cards waiting on the user, then Up next. Within those, the milestone with the most cards
// wins, and a tie goes to the later one in the plan. A finished milestone is never in
// hand. With no such card it is the plan's first open milestone.
const IN_HAND = [['Doing'], ['Needs your look', 'Needs your decision'], ['Up next']];
export function currentMilestone(plan, board) {
  const open = plan.milestones.filter((m) => m.status !== 'done');
  for (const lanes of IN_HAND) {
    const cards = (board?.columns ?? []).filter((c) => lanes.includes(c.name)).flatMap((c) => c.cards);
    const count = (m) => cards.filter((c) => c.milestone === m.id).length;
    const most = open.reduce((best, m) => (count(m) && count(m) >= (best ? count(best) : 0) ? m : best), null);
    if (most) return most;
  }
  return open.find((m) => m.status === 'in progress') ?? open.find((m) => m.status === 'not started');
}

// The header's line under the name: the milestone whose cards are moving (#217 took the
// row of milestone chips away; the board's menu and the Plan tab list them).
function renderMilestones(plan, board) {
  const current = currentMilestone(plan, board);
  return current
    ? `Working on ${milestoneInk(current.id)} ${inline(current.title)}`
    : plan.milestones.length
      ? 'Every milestone is done'
      : '';
}

// ---------- prose tabs ----------

// Puts an icon before any <h2> whose text is in `map` (heading text -> icon name).
function iconHeadings(html, map) {
  return html.replace(/<h2>(.*?)<\/h2>/g, (whole, text) => {
    const name = map[text.replace(/&#39;/g, "'")];
    return name ? `<h2 class="h-icon">${icon(name)}${text}</h2>` : whole;
  });
}

// "## 2026-09-30 · M0 finished · a85e8c3" -> icon, title, date chip, commit chip.
function datedHeadings(html, iconName) {
  return html.replace(/<h2>(\d{4}-\d{2}-\d{2}) · (.*?)<\/h2>/g, (_, date, rest) => {
    const parts = rest.split(' · ');
    const sha = /^[0-9a-f]{7,40}$/.test(parts.at(-1)) && parts.length > 1 ? parts.pop() : null;
    return `<h2 class="dated">${icon(iconName)}<span class="dated-title">${parts.join(' · ')}</span><span class="tag tag-proj">${icon('calendar')}${shortDate({ label: null, value: date })}</span>${sha ? `<code class="sha">${icon('git-commit-horizontal')}${sha}</code>` : ''}</h2>`;
  });
}

function renderProgress(plan) {
  const total = plan.milestones.length;
  if (!total) return '';
  const done = plan.milestones.filter((m) => m.status === 'done').length;
  const segs = plan.milestones
    .map((m) => `<span class="seg seg-${slug(m.status)}" title="${esc(`${m.id}: ${m.status}`)}"></span>`)
    .join('');
  return `<div class="progress"><div class="progress-bar" aria-hidden="true">${segs}</div><p class="progress-label">${icon('flag')}<b>${done} of ${total}</b> milestones done</p></div>`;
}

// "### M1 — The page · in progress" and the text under it -> a fold-out: the milestone's
// tag, name and status pill on the summary line, its text inside. Done ones start folded.
// A milestone not done says how long its cards still to build should take (#209).
function milestoneHeadings(html, plan, board, batchOf = () => null) {
  const current = currentMilestone(plan, board);
  return html.replace(
    /<h3>(M\d+) [—–-] (.+?) · (not started|in progress|done)(?: (\d{4}-\d{2}-\d{2}))?<\/h3>([\s\S]*?)(?=<h[23]>|$)/g,
    (_, id, title, status, date, body) => {
      const s = STATUS[status];
      const isCurrent = current?.id === id;
      const pill = `${s.label}${date ? ` ${shortDate({ label: null, value: date })}` : ''}`;
      const h3 = `<h3 class="ms-h ms-h-${slug(status)}">${milestoneTag(id)}<span>${title}</span><span class="st ${isCurrent ? 'st-open' : s.tone}">${pill}</span></h3>`;
      const left = status === 'done' ? 0 : cardsLeft(board, id);
      const guess = left ? batchOf(left) : null;
      const leftLine = guess ? `<p class="ms-left">${left} card${left === 1 ? '' : 's'} left · ${esc(batchText(guess))}</p>` : '';
      return `<details class="ms-fold" id="plan-${id}"${status === 'done' ? '' : ' open'}><summary>${h3}</summary><div class="ms-body">${leftLine}${body}</div></details>`;
    },
  );
}

function renderPlanTab(md, plan, board, batchOf) {
  // A milestone's "short:" line names its chip; the Plan tab already shows its full title.
  md = md.split('\n').filter((line) => !SHORT_LINE.test(line)).join('\n');
  const html = milestoneHeadings(iconHeadings(block(md), { Goal: 'target', 'Out of scope': 'ban', Milestones: 'flag' }), plan, board, batchOf);
  return renderProgress(plan) + html;
}

function renderReleases(md) {
  return datedHeadings(block(md), 'rocket').replace(
    /<strong>What(?:&#39;|')s new<\/strong>/g,
    `<strong class="h-icon">${icon('sparkles')}What's new</strong>`,
  );
}

const OVERVIEW_ICONS = { 'What it is': 'info', 'How to run it': 'terminal', "How it's built": 'wrench', Checks: 'list-todo' };
const LINK_SECTION_ICONS = {
  'This page': 'layout-dashboard', Live: 'globe', Local: 'server', Code: 'git-branch',
  Artifacts: 'file-text', References: 'book-marked', Phone: 'smartphone',
};

// Picks a link's icon from where it points: repo, artifact, local server, file or website.
export function linkIcon(href) {
  if (href.startsWith('file:')) return 'file';
  let host = '';
  try {
    host = new URL(href.replace(/&amp;/g, '&')).hostname;
  } catch {
    return 'link';
  }
  if (host === 'github.com') return 'git-branch';
  if (host.endsWith('claude.ai')) return 'sparkles';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost' || !host.includes('.')) return 'server';
  return 'globe';
}

// "- [label](url) · note · added date" -> icon, link, muted note.
function renderLinks(md) {
  const html = iconHeadings(block(md), LINK_SECTION_ICONS);
  return html.replace(/<li>(<a [^>]*href="([^"]+)"[^>]*>.*?<\/a>)(.*?)<\/li>/g, (_, link, href, rest) => {
    const note = rest.replace(/^\s*·\s*/, '');
    return `<li class="link-row">${icon(linkIcon(href))}${link}${note ? `<span class="link-note">${note}</span>` : ''}</li>`;
  });
}

// md: { board, plan, releases, overview, decisions, links, history, finished } — missing files are ''.
// pictures: design cards' option pictures, keyed "<card>-<letter>" (src/design.js).
// stampUrl: where the build leaves the page's stamp, for a page opened as a file (src/settings.js).
// habits: the project's habit states (src/habits.js), for the Settings tab.
export function renderPage({ name, md, builtAt, template, pictures = {}, stampUrl = '', habits = [] }) {
  const board = parseBoard(md.board);
  const plan = parsePlan(md.plan);
  const now = renderMilestones(plan, board);
  const events = parseHistory(md.history ?? '');
  const took = new Map(buildTimes(events).map((c) => [c.id, c.minutes]));
  const list = shares(events);
  const batchOf = (n) => batchFrom(list, n);
  const { html: boardHtml, filter, waiting } = renderBoard(board, builtAt, pictures, md.finished ?? '', Object.fromEntries(plan.milestones.map((m) => [m.id, m.short])), took, batchOf);
  const empty = (what) => `<p class="empty">No ${what} yet.</p>`;
  const parts = {
    name: esc(plan.title ?? name),
    now,
    nav: renderNav(waiting),
    built: `${icon('clock')}Updated ${esc(stamp(builtAt))}`,
    stamp: builtAt.toISOString(),
    stampUrl,
    version: VERSION,
    board: boardHtml,
    filter,
    key: KEY,
    plan: md.plan.trim() ? renderPlanTab(md.plan, plan, board, batchOf) : empty('plan'),
    reports: renderReports({ history: md.history ?? '', plan, builtAt }) + learningReport(events),
    releases: md.releases.trim() ? renderReleases(md.releases) : empty('releases'),
    docs:
      (md.overview.trim() ? iconHeadings(block(md.overview), OVERVIEW_ICONS) : empty('overview')) +
      (md.decisions.trim()
        ? `<h2 class="md-sec h-icon">${icon('scale')}Decisions</h2>${datedHeadings(block(md.decisions), 'circle-check')}`
        : ''),
    links: md.links.trim() ? renderLinks(md.links) : empty('links'),
    settings: renderSettings(habits),
  };
  // One pass, so a "{{…}}" inside the project's own Markdown is never expanded.
  const html = template.replace(/\{\{(\w+)\}\}/g, (_, key) => parts[key] ?? '');
  return { html, problems: [...board.problems, ...plan.problems] };
}
