// The Reports tab's "Are the guesses learning?" (#211): week by week, how many cards took a
// time inside their range, how the guesses did beside simply guessing the median, and each
// busy day's batch guess beside the time it took. It sits in its own file because guess.js
// already reads reports.js.
import { cardRows, dayRows } from './guess.js';
import { icon } from './icons.js';
import { duration } from './reports.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const mondayOf = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};
const close = (minutes, guess) => minutes >= guess / 2 && minutes <= guess * 2;
const share = (n, of) => (of ? `${n}/${of}` : '—');
const WEEKS = 8;
const DAYS = 8;

export function learningReport(events) {
  const cards = cardRows(events).filter((c) => c.low !== null);
  if (!cards.length) return '';
  // A card that carried its own range is judged by it; one from before ranges (#208) by the
  // range it would have been given, so the column has a history from the start.
  const range = (c) => c.range ?? [c.low, c.high];
  const inside = (c) => c.minutes >= range(c)[0] && c.minutes <= range(c)[1];
  const carried = cards.filter((c) => c.range);
  const weeks = new Map();
  for (const c of cards) {
    const key = mondayOf(c.end).getTime();
    weeks.set(key, [...(weeks.get(key) ?? []), c]);
  }
  const weekRows = [...weeks].slice(-WEEKS).map(([monday, wk]) => {
    const guessed = wk.filter((c) => c.guess != null);
    return `<tr><th scope="row">${dayLabel(new Date(monday))}</th><td>${wk.length}</td><td>${share(wk.filter(inside).length, wk.length)}</td><td>${share(guessed.filter((c) => close(c.minutes, c.guess)).length, guessed.length)}</td><td>${share(guessed.filter((c) => close(c.minutes, c.median)).length, guessed.length)}</td></tr>`;
  });
  const all = cards.filter(inside).length;
  const guessed = cards.filter((c) => c.guess != null);
  const byGuess = guessed.filter((c) => close(c.minutes, c.guess)).length;
  const byMedian = guessed.filter((c) => close(c.minutes, c.median)).length;
  const verdict = [
    carried.length
      ? `${carried.filter(inside).length} of ${carried.length} cards that carried a range took a time inside it, and it says 6 in 10.`
      : `No card carries a range yet; replayed on the past, ${all} of ${cards.length} cards (${Math.round((100 * all) / cards.length)}%) would have landed inside theirs, and it says 6 in 10.`,
    guessed.length ? `The cards' own guesses came within half to double ${byGuess} times in ${guessed.length}; simply guessing the median would have ${byMedian} times.` : '',
  ].filter(Boolean).join(' ');
  const days = dayRows(events).slice(-DAYS);
  const held = days.filter((d) => d.took <= d.surely).length;
  const dayTable = days.length
    ? `<p class="report-verdict">Busy days of 4 or more cards, each guessed from the days before: ${held} of ${days.length} took no longer than 'surely'.</p>
<details class="chart-table" open><summary>Each day's guess and its time</summary>
<table><thead><tr><th scope="col">Day</th><th scope="col">Cards</th><th scope="col">Likely</th><th scope="col">Surely</th><th scope="col">Took</th></tr></thead>
<tbody>${days.map((d) => `<tr><th scope="row">${dayLabel(d.day)}</th><td>${d.cards}</td><td>${duration(d.likely)}</td><td>${duration(d.surely)}</td><td>${duration(d.took)}${d.took > d.surely ? ' (over)' : ''}</td></tr>`).join('')}</tbody></table></details>`
    : '';
  return `<section class="report">
<header class="report-head"><h2 class="h-icon">${icon('target')}Are the guesses learning?</h2></header>
<p class="report-sub">A card's range comes from the cards finished before it, and is judged on its time in Doing. A day's guess comes from the days before, and is judged on its busy time: a minute shared by two cards in Doing counts half to each.</p>
<p class="report-verdict">${verdict}</p>
<details class="chart-table" open><summary>By week: inside the range, and within half to double of the guess or the median</summary>
<table><thead><tr><th scope="col">Week</th><th scope="col">Cards</th><th scope="col">Range</th><th scope="col">Guess</th><th scope="col">Median</th></tr></thead>
<tbody>${weekRows.join('')}</tbody></table></details>
${dayTable}
</section>`;
}
