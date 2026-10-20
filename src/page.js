// Turns a project's pm/*.md text into the finished page HTML (no file I/O here,
// so tests can render without touching disk).
import { Marked, marked } from '../vendor/marked.esm.js';
import { archivedDetails, doneCutoff } from './archive.js';
import { COLUMNS, SCALE, SHORT_LINE, STAGES, guessText, isDesign, isLater, msClass, parseBoard, parsePlan, stageOf } from './board.js';
import { icon } from './icons.js';
import { renderReports } from './reports.js';
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
  { name: 'Waiting on you', hint: 'your look or answer', key: 'waiting', icon: 'bell-ring', from: ['Needs your decision', 'Needs your look'] },
  { name: 'Doing', hint: 'Claude is on it', key: 'doing', icon: 'hammer', from: ['Doing'] },
  { name: 'Up next', hint: 'queued', key: 'up-next', icon: 'list-todo', from: ['Up next'] },
  { name: 'Ideas', hint: 'not planned yet', key: 'ideas', icon: 'lightbulb', from: ['Ideas'] },
  { name: 'Done', hint: 'last 48 hours', key: 'done', icon: 'circle-check', from: ['Done'] },
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
const pictureOf = (card, line, pictures) => OPTION.test(line) && pictures[`${card.id}-${line[0]}`];
function optionPicture(card, line, pictures) {
  const pic = pictureOf(card, line, pictures);
  return pic ? `<a class="pic-open" href="${pic.src}" target="_blank" title="Open full size in a new tab"><img class="option-pic" src="${pic.src}" width="${pic.width}" height="${pic.height}" alt="Option ${line[0]}, as a picture" loading="lazy"></a>` : '';
}

// A photo icon in the card's top row, with how many pictures are inside, so the user knows
// to open it.
function picturesTag(card, pictures) {
  const n = card.details.filter((d) => pictureOf(card, d, pictures)).length;
  return n ? `<span class="tag tag-pics" title="${n} ${n === 1 ? 'picture' : 'pictures'} inside">${icon('image')}${n}</span>` : '';
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
  const stage = stageOf(c, column);
  const wheel = stage ? stageBar(stage) : '';
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
  const size = c.points !== null ? sizeTag(c.points, c.guess) : '';
  const left = wheel || (size ? meta : '');
  const foot = left || size ? `<div class="card-foot">${left}${size}</div>` : '';
  if (left === meta) meta = '';
  // data-ms and data-later are for the milestone filter (template/refresh.html).
  const li = `<li class="card-x card-${tone}" data-ms="${esc(c.milestone ?? '')}"${later ? ' data-later' : ''}>`;
  if (!c.details.length) {
    return `${li}<div class="card-top">${top}</div><p class="card-title">${title}</p>${meta}${foot}</li>`;
  }
  const open = `<button class="card-open" type="button" popovertarget="${modalId}">${title}</button>`;
  const close = `<button class="modal-close" type="button" popovertarget="${modalId}" popovertargetaction="hide" aria-label="Close">${icon('x')}</button>`;
  const lines = c.details.map((d) => `<li>${newTab(inline(d))}${optionPicture(c, d, pictures)}</li>`).join('');
  const modal = `<div class="card-modal" id="${modalId}" popover role="dialog" aria-labelledby="${modalId}-h"><div class="card-top">${top}${close}</div><h2 class="modal-title" id="${modalId}-h">${title}</h2>${meta}${foot}<ul class="modal-body">${lines}</ul></div>`;
  return `${li}<div class="card-top">${topWith(picturesTag(c, pictures))}</div><p class="card-title">${open}</p><p class="card-note">${summaryOf(c.details)}</p>${meta}${foot}${modal}</li>`;
}

function renderLane(lane, cards, pictures, today, shorts) {
  const body = cards.length
    ? `<ul class="lane-body">${cards.map(({ card, column, later }, i) => renderCard(card, column, lane.key, `card-${lane.key}-${i}`, later, pictures, today, shorts)).join('\n')}</ul>`
    : '<p class="lane-empty">&mdash;</p>';
  return `<section class="lane lane-${lane.key}" aria-label="${esc(lane.name)}">
<div class="lane-head"><span class="lane-icon">${icon(lane.icon)}</span><span class="lane-name">${esc(lane.name)}</span><span class="lane-count">${cards.filter((c) => !c.later).length}</span>${lane.hint ? `<span class="lane-hint">${esc(lane.hint)}</span>` : ''}</div>
${body}
</section>`;
}

// Done shows the last 48 hours (doneCutoff, src/archive.js). Older cards are hidden here
// until `soloagile archive` takes them off board.md; a card with no date always shows.
function recentlyDone(builtAt) {
  const cutoff = doneCutoff(ymd(builtAt));
  return ({ card, column }) => column !== 'Done' || !card.date || card.date.value >= cutoff;
}

// The milestone filter: an All chip, then one chip per milestone that has a card on the
// board, in plan order. A click shows only that milestone's cards; the page's script does
// it and remembers the pick (template/refresh.html). One milestone or none needs no filter.
function renderFilter(cards, shorts) {
  const present = new Set(cards.map(({ card }) => card.milestone).filter(Boolean));
  const order = [...Object.keys(shorts), ...[...present].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))];
  const ids = [...new Set(order)].filter((id) => present.has(id));
  if (ids.length < 2) return '';
  const chip = (id) => `<button type="button" class="${withMs('ms-chip tag tag-proj', id)}" data-ms="${esc(id)}" aria-pressed="false">${icon('flag')}${esc(id)}${shortName(shorts[id])}</button>`;
  return `<div class="ms-filter" role="group" aria-label="Show one milestone's cards"><span class="ms-filter-label">Show</span><button type="button" class="ms-chip ms-all tag" data-ms="" aria-pressed="true">All</button>${ids.map(chip).join('')}</div>`;
}

// A Done card is one line on the board. Its detail lines are in the archive, so it still
// opens in full. `finished` is that archive's text.
function renderBoard(board, builtAt, pictures, finished = '', shorts = {}) {
  const today = ymd(builtAt);
  const kept = finished ? archivedDetails(finished) : new Map();
  const inFull = (card, column) => (column === 'Done' && !card.details.length && kept.has(card.id) ? { ...card, details: kept.get(card.id) } : card);
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
    html: lanes.map((lane) => renderLane(lane, cardsOf(lane.from), pictures, today, shorts)).join('\n'),
    filter: renderFilter(lanes.flatMap((lane) => cardsOf(lane.from)), shorts),
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
<div class="key-row"><span>${stageBar('develop', '')}</span><span class="key-name">Stage</span><span class="key-def">How far round the wheel: Plan, Design, Develop, Test, Release, Feedback.</span></div>
<div class="key-row"><span class="card-id">#7</span><span class="key-name">Card number</span><span class="key-def">Answer with it, e.g. "#7 yes".</span></div>
<div class="key-row"><span class="card-id">&hellip;</span><span class="key-name">Short line</span><span class="key-def">Click the card for its full description.</span></div>
<div class="key-row"><span class="lane-empty">&mdash;</span><span class="key-name">Not shown</span><span class="key-def">Work from earlier releases. See Releases.</span></div>
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

// The top row: the milestones still open, each with its short name and a link to its own
// place on the Plan tab, then one chip that counts the finished ones and opens that tab.
function renderMilestones(plan, board) {
  const current = currentMilestone(plan, board);
  const done = plan.milestones.filter((m) => m.status === 'done').length;
  const doneChip = done
    ? `<li><a class="st st-go ms-done" href="#plan" title="${done} milestone${done === 1 ? '' : 's'} done: see the plan">${icon('check')}${done} done</a></li>`
    : '';
  const pills = plan.milestones
    .filter((m) => m.status !== 'done')
    .map((m) => {
      const label = `${m.id}: ${m.title}, ${m.status}`;
      const s = STATUS[m.status];
      const cls = withMs(`st ${m === current ? 'st-open ms-current' : s.tone}`, m.id);
      return `<li class="${cls}" title="${esc(label)}"><a class="ms-link" href="#plan-${m.id}"><span class="visually-hidden">${esc(label)}</span><span aria-hidden="true">${icon(m === current ? 'circle-dot' : s.icon)}${esc(m.id)}${shortName(m.short)}</span></a></li>`;
    })
    .join('') + doneChip;
  const now = current
    ? `Working on ${milestoneInk(current.id)} ${inline(current.title)}`
    : plan.milestones.length
      ? 'Every milestone is done'
      : '';
  return { pills: pills ? `<ol class="ms-strip" aria-label="Milestones">${pills}</ol>` : '', now };
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
function milestoneHeadings(html, plan, board) {
  const current = currentMilestone(plan, board);
  return html.replace(
    /<h3>(M\d+) [—–-] (.+?) · (not started|in progress|done)(?: (\d{4}-\d{2}-\d{2}))?<\/h3>([\s\S]*?)(?=<h[23]>|$)/g,
    (_, id, title, status, date, body) => {
      const s = STATUS[status];
      const isCurrent = current?.id === id;
      const pill = `${s.label}${date ? ` ${shortDate({ label: null, value: date })}` : ''}`;
      const h3 = `<h3 class="ms-h ms-h-${slug(status)}">${milestoneTag(id)}<span>${title}</span><span class="st ${isCurrent ? 'st-open' : s.tone}">${pill}</span></h3>`;
      return `<details class="ms-fold" id="plan-${id}"${status === 'done' ? '' : ' open'}><summary>${h3}</summary><div class="ms-body">${body}</div></details>`;
    },
  );
}

function renderPlanTab(md, plan, board) {
  // A milestone's "short:" line names its chip; the Plan tab already shows its full title.
  md = md.split('\n').filter((line) => !SHORT_LINE.test(line)).join('\n');
  const html = milestoneHeadings(iconHeadings(block(md), { Goal: 'target', 'Out of scope': 'ban', Milestones: 'flag' }), plan, board);
  return renderProgress(plan) + html;
}

function renderReleases(md) {
  return datedHeadings(block(md), 'rocket').replace(
    /<strong>What(?:&#39;|')s new<\/strong>/g,
    `<strong class="h-icon">${icon('sparkles')}What's new</strong>`,
  );
}

const OVERVIEW_ICONS = { 'What it is': 'info', 'How to run it': 'terminal', "How it's built": 'wrench' };
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
export function renderPage({ name, md, builtAt, template, pictures = {}, stampUrl = '' }) {
  const board = parseBoard(md.board);
  const plan = parsePlan(md.plan);
  const { pills, now } = renderMilestones(plan, board);
  const { html: boardHtml, filter, waiting } = renderBoard(board, builtAt, pictures, md.finished ?? '', Object.fromEntries(plan.milestones.map((m) => [m.id, m.short])));
  const empty = (what) => `<p class="empty">No ${what} yet.</p>`;
  const parts = {
    name: esc(plan.title ?? name),
    now,
    nav: renderNav(waiting),
    milestones: pills,
    built: `${icon('clock')}Updated ${esc(stamp(builtAt))}`,
    stamp: builtAt.toISOString(),
    stampUrl,
    version: VERSION,
    board: boardHtml,
    filter,
    key: KEY,
    plan: md.plan.trim() ? renderPlanTab(md.plan, plan, board) : empty('plan'),
    reports: renderReports({ history: md.history ?? '', plan, builtAt }),
    releases: md.releases.trim() ? renderReleases(md.releases) : empty('releases'),
    docs:
      (md.overview.trim() ? iconHeadings(block(md.overview), OVERVIEW_ICONS) : empty('overview')) +
      (md.decisions.trim()
        ? `<h2 class="md-sec h-icon">${icon('scale')}Decisions</h2>${datedHeadings(block(md.decisions), 'circle-check')}`
        : ''),
    links: md.links.trim() ? renderLinks(md.links) : empty('links'),
  };
  // One pass, so a "{{…}}" inside the project's own Markdown is never expanded.
  const html = template.replace(/\{\{(\w+)\}\}/g, (_, key) => parts[key] ?? '');
  return { html, problems: [...board.problems, ...plan.problems] };
}
