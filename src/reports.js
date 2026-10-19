// The Reports tab: charts worked out from pm/history.md when the page is built.
// The page has no chart script, so each chart is an SVG that stretches to any width
// for its lines, with every label as HTML placed by percent. That keeps the text the
// same size on a phone as on the desktop.
import { GONE, parseHistory } from './history.js';
import { msClass } from './board.js';
import { icon } from './icons.js';

const when = (at) => new Date(at.replace(' ', 'T')); // "2026-10-02 14:31", local time
const round = (n) => Math.round(n * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`; // "2 Oct"

// ---------- the numbers ----------

// A card's points after an event. Some boards leave the points off a Done line, so a card
// finished from Doing or the user's look keeps the points it had. Anywhere else, no points
// means none: a sized idea that became a question has lost them on purpose.
const pointsAfter = (e, was) =>
  e.points ?? (e.lane === 'Done' && ['Doing', 'Needs your look', 'Done'].includes(was?.lane) ? was.points : 0);

// Applies one event to the cards the points are counted from.
function move(cards, e) {
  const was = cards.get(e.id);
  if (e.lane !== GONE) cards.set(e.id, { lane: e.lane, milestone: e.milestone, points: pointsAfter(e, was) });
  else if (was?.lane !== 'Done') cards.delete(e.id);
}

// An idea has a milestone too, the one it would join, but is not yet part of the plan.
const planned = (c) => c.milestone && c.lane !== 'Ideas';

function pointsOf(cards, counts) {
  const sum = (lanes) => [...cards.values()].reduce((n, c) => n + (counts(c) && (!lanes || lanes.includes(c.lane)) ? c.points : 0), 0);
  return { total: sum(), built: sum(['Needs your look', 'Done']), approved: sum(['Done']) };
}

// The burn-up, one step per moment a number changed: { at, total, built, approved }.
// A card counts once it is planned: it has a milestone and has left Ideas. Built means it reached
// the user's look; approved means Done. A finished card still counts after /soloagile:save clears it
// from the board; any other card that leaves was dropped, and leaves the total too.
// Steps before the first card with points are skipped.
export function burnup(events) {
  const cards = new Map();
  const steps = [];
  for (const e of events) {
    move(cards, e);
    const step = { at: e.at, ...pointsOf(cards, planned) };
    const last = steps.at(-1);
    if (last?.at === step.at) steps[steps.length - 1] = step;
    else if (!last ? step.total > 0 : ['total', 'built', 'approved'].some((k) => last[k] !== step[k])) steps.push(step);
  }
  return steps;
}

// One milestone's points as they stand now, for the home page's progress bar:
// { total, built, approved }, counted as the burn-up counts them.
export function milestonePoints(events, id) {
  const cards = new Map();
  for (const e of events) move(cards, e);
  return pointsOf(cards, (c) => planned(c) && c.milestone === id);
}

// When each finished milestone's last card was approved: [{ id, at }], oldest first.
export function milestoneEnds(events, milestones) {
  const lane = new Map();
  const ends = new Map();
  for (const e of events) {
    if (e.lane === 'Done' && lane.get(e.id) !== 'Done' && e.milestone) ends.set(e.milestone, e.at);
    lane.set(e.id, e.lane);
  }
  return milestones
    .filter((m) => m.status === 'done' && ends.has(m.id))
    .map((m) => ({ id: m.id, at: ends.get(m.id) }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

// Points approved in each week, Monday to Sunday: [{ start: Date, points }], oldest
// first, with every week from the first approval to `now`. A card counts in the week
// it reached Done, under the same rules as the burn-up's approved line.
export function weekly(events, now) {
  const cards = new Map();
  for (const e of events) {
    const was = cards.get(e.id);
    if (e.lane === GONE) {
      if (was?.lane !== 'Done') cards.delete(e.id);
      continue;
    }
    const doneAt = e.lane !== 'Done' ? null : was?.lane === 'Done' ? was.doneAt : when(e.at);
    cards.set(e.id, { lane: e.lane, milestone: e.milestone, points: pointsAfter(e, was), doneAt });
  }
  const done = [...cards.values()].filter((c) => c.doneAt && c.milestone && c.points);
  if (!done.length) return [];
  const weeks = [];
  const first = mondayOf(new Date(Math.min(...done.map((c) => c.doneAt))));
  for (const d = first; d <= now; d.setDate(d.getDate() + 7)) weeks.push({ start: new Date(d), points: 0 });
  for (const c of done) {
    const week = weeks.findLast((w) => w.start <= c.doneAt);
    if (week) week.points += c.points;
  }
  return weeks;
}

// How long each card took to build: from work starting (its first time in Doing, or as a
// design waiting on the user) to first reaching the user's look. [{ id, points, minutes }], for
// cards with points; a card whose start the log never saw is left out.
export function buildTimes(events) {
  const cards = new Map();
  for (const e of events) {
    const c = cards.get(e.id) ?? { id: e.id, points: null, start: null, end: null };
    cards.set(e.id, c);
    if (e.points !== null) c.points = e.points;
    const working = e.lane === 'Doing' || (e.lane === 'Needs your decision' && e.stage === 'design');
    if (working && !c.start) c.start = when(e.at);
    if ((e.lane === 'Needs your look' || e.lane === 'Done') && c.start && !c.end) c.end = when(e.at);
  }
  return [...cards.values()]
    .filter((c) => c.end && c.points !== null)
    .map((c) => ({ id: c.id, points: c.points, minutes: Math.max(1, Math.round((c.end - c.start) / 60000)) }));
}

const FLOW = [
  ['done', 'done', ['Done']],
  ['waiting', 'waiting on you', ['Needs your look', 'Needs your decision']],
  ['doing', 'doing', ['Doing']],
  ['upnext', 'up next', ['Up next']],
];

// How many cards sat in each lane, one step per moment a count changed:
// { at, done, waiting, doing, upnext }. Ideas are left out. Done only grows: a finished
// card still counts after /soloagile:save clears it from the board.
export function flow(events) {
  const lanes = new Map();
  const steps = [];
  for (const e of events) {
    if (e.lane !== GONE) lanes.set(e.id, e.lane);
    else if (lanes.get(e.id) !== 'Done') lanes.delete(e.id);
    const step = { at: e.at };
    for (const [k, , from] of FLOW) step[k] = [...lanes.values()].filter((l) => from.includes(l)).length;
    const last = steps.at(-1);
    if (last?.at === step.at) steps[steps.length - 1] = step;
    else if (!last || FLOW.some(([k]) => last[k] !== step[k])) steps.push(step);
  }
  return steps;
}

function mondayOf(d) {
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

// ---------- scales ----------

// A top value just above `max`, and up to five round ticks: 65 -> 0, 20, 40, 60, 80.
export function niceScale(max) {
  let step = 1;
  for (let mag = 1; ; mag *= 10) {
    step = [1, 2, 5].map((s) => s * mag).find((s) => max / s < 4);
    if (step) break;
  }
  const top = (Math.floor(max / step) + 1) * step;
  return { top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) };
}

const TICK_HOURS = [1, 2, 3, 6, 12, 24, 48, 72, 168, 336, 720, 2160];

// At most six time labels, on round hours or whole days: [{ at: Date, text }].
export function timeTicks(t0, t1) {
  const hours = (t1 - t0) / 3600000;
  const step = TICK_HOURS.find((s) => hours / s <= 6) ?? TICK_HOURS.at(-1);
  const ticks = [];
  const d = new Date(t0);
  d.setHours(0, 0, 0, 0);
  for (; d <= t1; d.setHours(d.getHours() + step)) {
    if (d < t0) continue;
    // Hour labels say the day once, on the first of them.
    const hour = step < 24 && d.getHours() ? `${pad(d.getHours())}:00` : '';
    ticks.push({ at: new Date(d), text: hour && ticks.length ? hour : `${dayLabel(d)}${hour && ` ${hour}`}` });
  }
  return ticks;
}

// ---------- the chart ----------

const SERIES = [
  ['total', 'total'],
  ['built', 'built'],
  ['approved', 'approved'],
];

// A label near an edge is pinned to that edge, so it never hangs off the plot.
const edge = (x) => (x < 8 ? ' at-start' : x > 92 ? ' at-end' : '');

function burnupChart(steps, marks, builtAt) {
  const t0 = when(steps[0].at);
  // Never narrower than an hour, so a project with one moment of history still draws.
  const t1 = new Date(Math.max(builtAt, when(steps.at(-1).at), t0.getTime() + 3600000));
  const { top, ticks } = niceScale(Math.max(...steps.map((s) => s.total)));
  const x = (t) => round(((t - t0) / (t1 - t0)) * 100);
  const y = (v) => round(100 - (v / top) * 100);
  const line = (k) => `${steps.reduce((d, s, i) => (i ? `${d}H${x(when(s.at))}V${y(s[k])}` : `M0 ${y(s[k])}`), '')}H100`;
  const now = steps.at(-1);

  // A marker where each milestone ended. Those that ended close together share one label.
  const ends = marks.map((m) => ({ id: m.id, x: x(when(m.at)) })).filter((m) => m.x >= 0 && m.x <= 100);
  const labels = [];
  for (const m of ends) {
    const near = labels.at(-1);
    if (near && m.x - near.x < 9) near.ids.push(m.id);
    else labels.push({ x: m.x, ids: [m.id] });
  }

  const summary = `Burn-up: ${now.total} points in total, ${now.built} built, ${now.approved} approved`;
  return `<div class="plot" role="img" aria-label="${summary}">
<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
${ticks.map((v) => `<line x1="0" x2="100" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/>`).join('')}
${ends.map((m) => `<line x1="${m.x}" x2="${m.x}" y1="0" y2="100" class="chart-rule"/>`).join('')}
<path d="${line('built')}V100H0Z" class="chart-wash s-built"/><path d="${line('approved')}V100H0Z" class="chart-wash s-approved"/>
${SERIES.map(([k]) => `<path d="${line(k)}" class="chart-line s-${k}"/>`).join('')}
</svg>
${SERIES.map(([k]) => `<span class="chart-dot s-${k}" style="top:${y(now[k])}%"></span>`).join('')}
${ticks.map((v) => `<span class="chart-y" style="top:${y(v)}%">${v}</span>`).join('')}
${timeTicks(t0, t1).map((t) => `<span class="chart-x${edge(x(t.at))}" style="left:${x(t.at)}%">${t.text}</span>`).join('')}
${labels.map((m) => `<span class="chart-mark${edge(m.x)}" style="left:${m.x}%">${m.ids.map((id) => `<b class="ms-ink ${msClass(id)}">${id}</b>`).join(' ')}</span>`).join('')}
</div>`;
}

// The same numbers as a table, one row per day that had a change, for exact values.
function burnupTable(steps) {
  const days = new Map();
  for (const s of steps) days.set(s.at.slice(0, 10), s);
  const rows = [...days].map(
    ([day, s]) => `<tr><th scope="row">${dayLabel(when(`${day} 00:00`))}</th><td>${s.total}</td><td>${s.built}</td><td>${s.approved}</td></tr>`,
  );
  return `<details class="chart-table"><summary>The numbers, day by day</summary>
<table><thead><tr><th scope="col">End of</th><th scope="col">Total</th><th scope="col">Built</th><th scope="col">Approved</th></tr></thead>
<tbody>${rows.join('')}</tbody></table></details>`;
}

// The bands are stacked in flow order, Done at the bottom, with a thin gap in the
// surface colour between them so neighbours never touch.
function flowReport(events, builtAt) {
  const steps = flow(events);
  if (!steps.length) return '';
  const t0 = when(steps[0].at);
  const t1 = new Date(Math.max(builtAt, when(steps.at(-1).at), t0.getTime() + 3600000));
  const { top, ticks } = niceScale(Math.max(...steps.map((s) => FLOW.reduce((n, [k]) => n + s[k], 0))));
  const x = (t) => round(((t - t0) / (t1 - t0)) * 100);
  const y = (v) => round(100 - (v / top) * 100);
  // A stepped outline: each value holds until the next moment, then the last holds to the edge.
  const outline = (values) => values.flatMap((v, i) => [[x(when(steps[i].at)), v], [i + 1 < steps.length ? x(when(steps[i + 1].at)) : 100, v]]);
  const path = (pts) => pts.map(([px, v], i) => `${i ? 'L' : 'M'}${px} ${y(v)}`).join('');
  let base = steps.map(() => 0);
  let shapes = '';
  for (const [k] of FLOW) {
    const upper = base.map((b, i) => b + steps[i][k]);
    shapes += `<path d="${path([...outline(upper), ...outline(base).reverse()])}Z" class="chart-band s-${k}"/><path d="${path(outline(upper))}" class="chart-gap"/>`;
    base = upper;
  }
  const now = steps.at(-1);
  const key = [...FLOW].reverse().map(([k, label]) => `<li><i class="chart-sq s-${k}"></i><b>${now[k]}</b> ${label}</li>`).join('');
  const summary = `Cards in each lane: ${FLOW.map(([k, label]) => `${now[k]} ${label}`).join(', ')}`;
  const days = new Map();
  for (const s of steps) days.set(s.at.slice(0, 10), s);
  const rows = [...days].map(([day, s]) => `<tr><th scope="row">${dayLabel(when(`${day} 00:00`))}</th>${[...FLOW].reverse().map(([k]) => `<td>${s[k]}</td>`).join('')}</tr>`);
  return `<section class="report">
<header class="report-head"><h2 class="h-icon">${icon('chart-area')}Flow</h2></header>
<p class="report-sub">How many cards sat in each lane over time. A band that keeps widening is where work piles up.</p>
<ul class="chart-key">${key}</ul>
<div class="plot" role="img" aria-label="${summary}">
<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
${ticks.map((v) => `<line x1="0" x2="100" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/>`).join('')}
${shapes}
</svg>
${ticks.map((v) => `<span class="chart-y" style="top:${y(v)}%">${v}</span>`).join('')}
${timeTicks(t0, t1).map((t) => `<span class="chart-x${edge(x(t.at))}" style="left:${x(t.at)}%">${t.text}</span>`).join('')}
</div>
<details class="chart-table"><summary>The numbers, day by day</summary>
<table><thead><tr><th scope="col">End of</th><th scope="col">Up next</th><th scope="col">Doing</th><th scope="col">Waiting</th><th scope="col">Done</th></tr></thead>
<tbody>${rows.join('')}</tbody></table></details>
</section>`;
}

const SIZES = [1, 2, 3, 5, 8, 13];
// Dots in a column are nudged sideways in turn, so cards that took the same time don't hide each other.
const NUDGE = [0, -2.2, 2.2, -1.1, 1.1, -3.3, 3.3];
const median = (a) => {
  const s = [...a].sort((p, q) => p - q);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
// "43 min", "3.5 h", "2 d": the unit follows the size of the number.
export const duration = (minutes) =>
  minutes < 120 ? `${Math.round(minutes)} min` : minutes < 2880 ? `${round(minutes / 60).toFixed(1).replace('.0', '')} h` : `${round(minutes / 1440).toFixed(1).replace('.0', '')} d`;

// A column per card size, a dot per card, and a bar at the usual (middle) time for the
// sizes with at least two cards.
function buildTimeReport(events) {
  const cards = buildTimes(events);
  if (!cards.length) return '';
  const longest = Math.max(...cards.map((c) => c.minutes));
  const [per, unit] = longest < 120 ? [1, 'm'] : longest < 2880 ? [60, 'h'] : [1440, 'd'];
  const { top, ticks } = niceScale(longest / per);
  const y = (minutes) => round(100 - (minutes / per / top) * 100);
  const col = (size) => round(((SIZES.indexOf(size) + 0.5) / SIZES.length) * 100);
  const rows = [];
  const marks = SIZES.map((size) => {
    const mine = cards.filter((c) => c.points === size);
    if (!mine.length) return `<span class="chart-none" style="left:${col(size)}%">none yet</span>`;
    const usual = median(mine.map((c) => c.minutes));
    rows.push(`<tr><th scope="row">${size} pt${size === 1 ? '' : 's'}</th><td>${mine.length}</td><td>${duration(usual)}</td><td>${duration(Math.max(...mine.map((c) => c.minutes)))}</td></tr>`);
    const dots = mine.map((c, i) => `<span class="chart-dot s-built" style="left:${round(col(size) + NUDGE[i % NUDGE.length])}%;top:${y(c.minutes)}%" title="#${c.id} · ${duration(c.minutes)}"></span>`);
    return (mine.length > 1 ? `<span class="chart-usual" style="left:${col(size)}%;top:${y(usual)}%"></span>` : '') + dots.join('');
  });
  return `<section class="report">
<header class="report-head"><h2 class="h-icon">${icon('timer')}Time to build, by size</h2></header>
<p class="report-sub">From work starting on a card to it reaching your look. If the sizes are guessed well, bigger cards sit higher.</p>
<ul class="chart-key"><li><i class="chart-dot-key s-built"></i>one card</li><li><i class="chart-usual-key"></i>the usual time for that size</li></ul>
<div class="plot plot-sizes" role="img" aria-label="Time to build ${cards.length} card${cards.length === 1 ? '' : 's'}, grouped by story points">
<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
${ticks.map((v) => `<line x1="0" x2="100" y1="${round(100 - (v / top) * 100)}" y2="${round(100 - (v / top) * 100)}" class="chart-grid"/>`).join('')}
</svg>
${ticks.map((v) => `<span class="chart-y" style="top:${round(100 - (v / top) * 100)}%">${v}${v ? unit : ''}</span>`).join('')}
${SIZES.map((size) => `<span class="chart-x" style="left:${col(size)}%">${size} pt${size === 1 ? '' : 's'}</span>`).join('')}
${marks.join('')}
</div>
<details class="chart-table"><summary>The numbers, by size</summary>
<table><thead><tr><th scope="col">Size</th><th scope="col">Cards</th><th scope="col">Usual</th><th scope="col">Longest</th></tr></thead>
<tbody>${rows.join('')}</tbody></table></details>
</section>`;
}

const WEEKS_SHOWN = 8;

// One column per week, with its number on top. The month is named on the first column
// and wherever it changes, and the week in hand is "Now", so eight labels fit a phone.
function weeklyReport(events, builtAt) {
  const weeks = weekly(events, builtAt).slice(-WEEKS_SHOWN);
  if (!weeks.length) return '';
  const { top } = niceScale(Math.max(...weeks.map((w) => w.points)));
  const cols = weeks.map((w, i) => {
    const named = !i || w.start.getMonth() !== weeks[i - 1].start.getMonth();
    const label = i === weeks.length - 1 ? 'Now' : named ? dayLabel(w.start) : w.start.getDate();
    return `<li style="--h:${round((w.points / top) * 100)}%"><b>${w.points}</b><i class="bar s-approved"></i><span>${label}</span></li>`;
  });
  return `<section class="report">
<header class="report-head"><h2 class="h-icon">${icon('chart-column')}Finished per week</h2></header>
<p class="report-sub">Story points you approved in each week, Monday to Sunday. Each bar is named by its Monday.</p>
<ol class="bars">${cols.join('')}</ol>
</section>`;
}

function burnupReport(events, plan, builtAt) {
  const steps = burnup(events);
  const open = plan.milestones.filter((m) => m.status === 'in progress').map((m) => m.id);
  const pill = open.length ? `<span class="st st-open">${open.join(', ')} in progress</span>` : '';
  const head = `<header class="report-head"><h2 class="h-icon">${icon('chart-line')}Burn-up</h2>${pill}</header>`;
  if (!steps.length) {
    return `<section class="report">${head}<p class="empty">No points yet. The chart starts with the first card that has story points and a milestone.</p></section>`;
  }
  const now = steps.at(-1);
  const key = SERIES.map(([k, label]) => `<li><i class="chart-sw s-${k}"></i><b>${now[k]}</b> ${label}</li>`).join('');
  return `<section class="report">${head}
<p class="report-sub">Story points over time. The gap between built and approved is what waits on you.</p>
<ul class="chart-key">${key}</ul>
${burnupChart(steps, milestoneEnds(events, plan.milestones), builtAt)}
${burnupTable(steps)}
</section>`;
}

// plan: parsePlan's result.
export function renderReports({ history, plan, builtAt }) {
  const events = parseHistory(history);
  return burnupReport(events, plan, builtAt) + flowReport(events, builtAt) + weeklyReport(events, builtAt) + buildTimeReport(events);
}
