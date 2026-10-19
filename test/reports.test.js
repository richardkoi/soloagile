import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHistory } from '../src/history.js';
import { buildTimes, burnup, duration, flow, milestoneEnds, niceScale, renderReports, timeTicks, weekly } from '../src/reports.js';

const log = (...lines) => parseHistory(lines.map((l) => `- 2026-10-02 ${l}`).join('\n'));
const numbers = (steps) => steps.map((s) => [s.at.slice(11), s.total, s.built, s.approved]);

test('burn-up: total, built and approved points at each moment something changed', () => {
  const steps = burnup(
    log(
      '09:00 · Up next · #1 A · M1 · 3 pts',
      '09:00 · Up next · #2 B · M1 · 5 pts',
      '10:00 · Doing · #1 A · M1 · 3 pts · develop',
      '11:00 · Needs your look · #1 A · M1 · 3 pts',
      '12:00 · Done · #1 A · M1 · 3 pts',
    ),
  );
  assert.deepEqual(numbers(steps), [
    ['09:00', 8, 0, 0],
    ['11:00', 8, 3, 0],
    ['12:00', 8, 3, 3],
  ]);
});

test('burn-up: ideas and cards without points add nothing, and the chart starts at the first points', () => {
  const steps = burnup(
    log(
      '08:00 · Up next · #1 Before points · M1',
      '08:30 · Ideas · #2 An idea · 5 pts',
      '09:00 · Up next · #3 Sized · M1 · 2 pts',
      '10:00 · Up next · #2 An idea · M1 · 5 pts',
    ),
  );
  assert.deepEqual(numbers(steps), [
    ['09:00', 2, 0, 0],
    ['10:00', 7, 0, 0],
  ]);
});

test('burn-up: a finished card cleared from the board still counts; a dropped card leaves the total', () => {
  const steps = burnup(
    log(
      '09:00 · Done · #1 Finished · M1 · 3 pts',
      '09:00 · Up next · #2 Dropped · M1 · 5 pts',
      '10:00 · gone · #1 Finished · M1 · 3 pts',
      '11:00 · gone · #2 Dropped · M1 · 5 pts',
    ),
  );
  assert.deepEqual(numbers(steps), [
    ['09:00', 8, 3, 3],
    ['11:00', 3, 3, 3],
  ]);
});

test('burn-up: a card keeps its points when its Done line drops them', () => {
  const steps = burnup(log('09:00 · Needs your look · #1 A · M1 · 3 pts', '10:00 · Done · #1 A · M1'));
  assert.deepEqual(numbers(steps), [
    ['09:00', 3, 3, 0],
    ['10:00', 3, 3, 3],
  ]);
});

test('an idea is left out of the points, even with a milestone, until it is planned', () => {
  const steps = burnup(log('09:00 · Up next · #1 Real work · M1 · 2 pts', '09:00 · Ideas · #2 An idea · M1 · 13 pts', '10:00 · Up next · #2 An idea · M1 · 13 pts'));
  assert.deepEqual(steps.map((s) => s.total), [2, 15]);
});

test('a milestone ends when its last card is approved; unfinished milestones have no end', () => {
  const events = log(
    '09:00 · Done · #1 A · M1 · 3 pts',
    '10:00 · Done · #2 B · M1 · 2 pts',
    '10:30 · Done · #2 B renamed · M1 · 2 pts',
    '11:00 · Done · #3 C · M2 · 1 pt',
  );
  const milestones = [
    { id: 'M1', status: 'done' },
    { id: 'M2', status: 'in progress' },
  ];
  assert.deepEqual(milestoneEnds(events, milestones), [{ id: 'M1', at: '2026-10-02 10:00' }]);
});

test('the points axis tops out just above the highest value, on round ticks', () => {
  assert.deepEqual(niceScale(65), { top: 80, ticks: [0, 20, 40, 60, 80] });
  assert.deepEqual(niceScale(24), { top: 30, ticks: [0, 10, 20, 30] });
  assert.deepEqual(niceScale(3), { top: 4, ticks: [0, 1, 2, 3, 4] });
});

test('time labels: hours for a short span, with the day on the first; days for a long one', () => {
  const short = timeTicks(new Date(2026, 9, 2, 12, 28), new Date(2026, 9, 2, 14, 40));
  assert.deepEqual(short.map((t) => t.text), ['2 Oct 13:00', '14:00']);
  const long = timeTicks(new Date(2026, 9, 2, 12, 0), new Date(2026, 9, 6, 9, 0));
  assert.deepEqual(long.map((t) => t.text), ['3 Oct', '4 Oct', '5 Oct', '6 Oct']);
  assert.ok(timeTicks(new Date(2026, 0, 1), new Date(2026, 11, 31)).length <= 6);
});

test('the Reports tab shows the numbers, a marker per finished milestone, and what is in progress', () => {
  const history = [
    '- 2026-10-02 09:00 · Done · #1 A · M1 · 3 pts',
    '- 2026-10-02 10:00 · Needs your look · #2 B · M2 · 5 pts',
    '- 2026-10-02 10:00 · Up next · #3 C · M2 · 2 pts',
  ].join('\n');
  const plan = { milestones: [{ id: 'M1', status: 'done' }, { id: 'M2', status: 'in progress' }] };
  const html = renderReports({ history, plan, builtAt: new Date(2026, 9, 2, 12, 0) });
  assert.match(html, /<b>10<\/b> total/);
  assert.match(html, /<b>8<\/b> built/);
  assert.match(html, /<b>3<\/b> approved/);
  assert.match(html, /aria-label="Burn-up: 10 points in total, 8 built, 3 approved"/);
  assert.match(html, /class="chart-mark[^"]*" style="left:0%"><b class="ms-ink ms-c1">M1<\/b></);
  assert.match(html, /M2 in progress/);
  assert.match(html, /<th scope="row">2 Oct<\/th><td>10<\/td><td>8<\/td><td>3<\/td>/);
});

test('a project with no points yet gets a line of text, not an empty chart', () => {
  const html = renderReports({ history: '', plan: { milestones: [] }, builtAt: new Date() });
  assert.match(html, /No points yet/);
  assert.doesNotMatch(html, /class="plot"/);
});

test('points per week: a card counts in the week it was approved, Monday to Sunday', () => {
  const events = parseHistory(
    [
      '- 2026-09-28 09:00 · Done · #1 Monday · M1 · 3 pts',
      '- 2026-10-04 23:00 · Done · #2 Sunday night · M1 · 2 pts',
      '- 2026-10-04 23:30 · Done · #2 Sunday night, renamed · M1',
      '- 2026-10-05 00:30 · Done · #3 Next Monday · M2 · 5 pts',
      '- 2026-10-06 10:00 · Needs your look · #4 Not approved · M2 · 8 pts',
      '- 2026-10-07 10:00 · gone · #1 Monday · M1 · 3 pts',
    ].join('\n'),
  );
  const weeks = weekly(events, new Date(2026, 9, 21, 12, 0));
  assert.deepEqual(weeks.map((w) => [w.start.getDate(), w.points]), [[28, 5], [5, 5], [12, 0], [19, 0]]);
  assert.equal(weeks.reduce((n, w) => n + w.points, 0), burnup(events).at(-1).approved, 'the bars add up to the burn-up');
});

test('the Reports tab has a column per week, and none before anything is approved', () => {
  const plan = { milestones: [] };
  const history = '- 2026-10-02 09:00 · Done · #1 A · M1 · 3 pts';
  const html = renderReports({ history, plan, builtAt: new Date(2026, 9, 2, 12, 0) });
  assert.match(html, /Finished per week/);
  assert.match(html, /<li style="--h:75%"><b>3<\/b><i class="bar s-approved"><\/i><span>Now<\/span><\/li>/);
  const none = renderReports({ history: '- 2026-10-02 09:00 · Up next · #1 A · M1 · 3 pts', plan, builtAt: new Date(2026, 9, 2, 12, 0) });
  assert.doesNotMatch(none, /Finished per week/);
});

test('time to build runs from work starting to the card reaching your look', () => {
  const events = log(
    '09:00 · Up next · #1 Plain · M1 · 3 pts',
    '10:00 · Doing · #1 Plain · M1 · 3 pts · develop',
    '10:20 · Doing · #1 Plain · M1 · 3 pts · test',
    '10:45 · Needs your look · #1 Plain · M1 · 3 pts',
    '11:00 · Doing · #1 Plain · M1 · 3 pts · develop',
    '12:00 · Needs your look · #1 Plain · M1 · 3 pts',
    '09:00 · Needs your decision · #2 Designed first · M1 · 5 pts · design',
    '09:30 · Doing · #2 Designed first · M1 · 5 pts · develop',
    '13:00 · Done · #2 Designed first · M1',
    '09:00 · Needs your look · #3 Start never seen · M1 · 2 pts',
    '09:00 · Doing · #4 Not finished · M1 · 2 pts · develop',
    '09:00 · Doing · #5 No points · M1 · develop',
    '09:30 · Needs your look · #5 No points · M1',
  );
  assert.deepEqual(buildTimes(events), [
    { id: 1, points: 3, minutes: 45 },
    { id: 2, points: 5, minutes: 240 },
  ]);
});

test('durations read in minutes, hours or days', () => {
  assert.deepEqual([43, 119, 120, 210, 2880, 5040].map(duration), ['43 min', '119 min', '2 h', '3.5 h', '2 d', '3.5 d']);
});

test('flow counts the cards in each lane; ideas are left out and Done only grows', () => {
  const steps = flow(
    log(
      '09:00 · Ideas · #1 An idea',
      '09:00 · Up next · #2 A · M1 · 3 pts',
      '09:00 · Needs your decision · #3 A question? · M1',
      '10:00 · Doing · #2 A · M1 · 3 pts · develop',
      '11:00 · Needs your look · #2 A · M1 · 3 pts',
      '12:00 · Done · #2 A · M1 · 3 pts',
      '13:00 · gone · #2 A · M1 · 3 pts',
      '14:00 · gone · #3 A question? · M1',
    ),
  );
  assert.deepEqual(steps.map((s) => [s.at.slice(11), s.upnext, s.doing, s.waiting, s.done]), [
    ['09:00', 1, 0, 1, 0],
    ['10:00', 0, 1, 1, 0],
    ['11:00', 0, 0, 2, 0],
    ['12:00', 0, 0, 1, 1],
    ['14:00', 0, 0, 0, 1],
  ]);
});

test('the Reports tab draws the flow bands and a dot per built card', () => {
  const history = [
    '- 2026-10-02 09:00 · Doing · #1 A · M1 · 3 pts · develop',
    '- 2026-10-02 09:40 · Needs your look · #1 A · M1 · 3 pts',
    '- 2026-10-02 09:40 · Up next · #2 B · M1 · 2 pts',
  ].join('\n');
  const html = renderReports({ history, plan: { milestones: [] }, builtAt: new Date(2026, 9, 2, 12, 0) });
  assert.match(html, /<b>1<\/b> waiting on you/);
  assert.match(html, /<b>1<\/b> up next/);
  assert.equal(html.match(/class="chart-band /g).length, 4);
  assert.match(html, /class="chart-dot s-built" style="left:41\.67%;top:33\.33%" title="#1 · 40 min"/);
  assert.match(html, /<th scope="row">3 pts<\/th><td>1<\/td><td>40 min<\/td><td>40 min<\/td>/);
});

test('burn-up: a sized idea that became an answered question has no points', () => {
  const steps = burnup(log('09:00 · Up next · #1 Real work · M1 · 2 pts', '09:00 · Ideas · #2 An idea · 13 pts', '10:00 · Done · #2 Which way? · M1'));
  assert.deepEqual(numbers(steps), [['09:00', 2, 0, 0]]);
});
