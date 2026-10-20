import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHistory } from '../src/history.js';
import { buildTimes, burnup, placeMarks, guessResults, guessVerdict, duration, flow, milestoneEnds, niceScale, renderReports, timeTicks, weekly } from '../src/reports.js';

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

test('guesses: how many built cards took half to double their guess, week by week', () => {
  const card = (id, day, guess, took) => {
    const start = `2026-10-${day} 09:00`;
    const end = new Date(Date.UTC(2026, 9, Number(day), 9, took)).toISOString().slice(11, 16);
    return [`- ${start} · Doing · #${id} C${id} · M1 · 3 pts · ~${guess} min · develop`, `- 2026-10-${day} ${end} · Needs your look · #${id} C${id} · M1 · 3 pts · ~${guess} min`];
  };
  const events = parseHistory(
    [
      card(1, '06', 40, 100), // too long
      card(2, '07', 40, 50), // close
      card(3, '13', 30, 35),
      card(4, '14', 30, 25),
      card(5, '14', 60, 20), // too short
      '- 2026-10-14 09:00 · Doing · #6 No guess · M1 · 3 pts · develop',
      '- 2026-10-14 10:00 · Needs your look · #6 No guess · M1 · 3 pts',
    ].flat().join('\n'),
  );
  assert.deepEqual(
    guessResults(events).map((r) => [r.id, r.guess, r.minutes, r.close]),
    [[1, 40, 100, false], [2, 40, 50, true], [3, 30, 35, true], [4, 30, 25, true], [5, 60, 20, false]],
  );
  assert.equal(guessVerdict(guessResults(events)), '3 of 5 guessed cards took between half and double their guess. By week: 5 Oct 1 of 2, 12 Oct 2 of 3, so getting better.');
  assert.equal(guessVerdict([]), '');
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
  assert.equal(html.match(/class="chart-band /g).length, 3);
  assert.doesNotMatch(html, /chart-band s-done/);
  assert.match(html, /class="chart-dot s-built" style="left:41\.67%;top:9\.9%" title="#1 · 40 min"/);
  assert.match(html, /<th scope="row">3 pts<\/th><td>1<\/td><td>40 min<\/td><td>40 min to 40 min<\/td><td>40 min<\/td>/);
});

test('burn-up: a sized idea that became an answered question has no points', () => {
  const steps = burnup(log('09:00 · Up next · #1 Real work · M1 · 2 pts', '09:00 · Ideas · #2 An idea · 13 pts', '10:00 · Done · #2 Which way? · M1'));
  assert.deepEqual(numbers(steps), [['09:00', 2, 0, 0]]);
});

test('time to build counts only the time spent working, not time parked between spells', () => {
  const events = parseHistory([
    '- 2026-10-02 09:00 · Doing · #1 Parked · M1 · 3 pts · develop',
    '- 2026-10-02 10:00 · Up next · #1 Parked · M1 · 3 pts',
    '- 2026-10-03 09:00 · Doing · #1 Parked · M1 · 3 pts · develop',
    '- 2026-10-03 09:30 · Needs your decision · #1 Parked · M1',
    '- 2026-10-03 15:00 · Doing · #1 Parked · M1 · 3 pts · develop',
    '- 2026-10-03 15:15 · Needs your look · #1 Parked · M1 · 3 pts',
    '- 2026-10-03 16:00 · Doing · #1 Parked · M1 · 3 pts · develop',
    '- 2026-10-03 18:00 · Needs your look · #1 Parked · M1 · 3 pts',
  ].join('\n'));
  assert.deepEqual(buildTimes(events), [{ id: 1, points: 3, minutes: 105 }]);
});

test('time to build leaves out cards that went through Doing in under 3 minutes, and says how many', () => {
  const history = [
    '- 2026-10-02 09:00 · Doing · #1 Real · M1 · 3 pts · develop',
    '- 2026-10-02 09:40 · Needs your look · #1 Real · M1 · 3 pts',
    '- 2026-10-02 10:00 · Doing · #2 Moved after · M1 · 1 pt · develop',
    '- 2026-10-02 10:00 · Done · #2 Moved after · M1 · 1 pt',
    '- 2026-10-02 10:00 · Doing · #3 Also after · M1 · 2 pts · develop',
    '- 2026-10-02 10:02 · Needs your look · #3 Also after · M1 · 2 pts',
  ].join('\n');
  const html = renderReports({ history, plan: { milestones: [] }, builtAt: new Date(2026, 9, 2, 12, 0) });
  assert.deepEqual(html.match(/title="#\d+ · [^"]+"/g), ['title="#1 · 40 min"']);
  assert.match(html, /2 cards went through Doing in under 3 minutes, so were moved there after the work: they are left out\./);
});

test('time to build says in a line whether size predicts time', () => {
  const card = (id, pts, start, mins) => {
    const end = new Date(2026, 9, 2, 9, start + mins);
    const at = `${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
    return [`- 2026-10-02 09:${pad2(start)} · Doing · #${id} C · M1 · ${pts} pts · develop`, `- 2026-10-02 ${at} · Needs your look · #${id} C · M1 · ${pts} pts`];
  };
  const pad2 = (n) => String(n).padStart(2, '0');
  const html = (sets) => renderReports({ history: sets.flatMap((s, i) => card(i + 1, ...s)).join('\n'), plan: { milestones: [] }, builtAt: new Date(2026, 9, 2, 23, 0) });
  const flat = [[3, 0, 40], [3, 1, 40], [3, 2, 40], [5, 3, 41], [5, 4, 41], [5, 5, 41]];
  assert.match(html(flat), /<p class="report-verdict">Size isn’t predicting time here: the usual time is 40 min for 3 pts and 41 min for 5 pts\.<\/p>/);
  const rising = [[1, 0, 10], [1, 1, 10], [1, 2, 10], [5, 3, 60], [5, 4, 60], [5, 5, 60]];
  assert.match(html(rising), /<p class="report-verdict">Bigger cards take longer, so the sizes are guessed well: the usual time is 10 min for 1 pt and 60 min for 5 pts\.<\/p>/);
  assert.match(html(flat.slice(0, 4)), /<p class="report-verdict">Too few cards yet to say whether size predicts time\.<\/p>/);
});

test('burn-up: many milestones in progress make a short header, and each milestone line is drawn once', () => {
  const history = ['- 2026-10-02 09:00 · Up next · #1 A · M1 · 3 pts', '- 2026-10-02 10:00 · Done · #1 A · M1 · 3 pts', '- 2026-10-02 10:00 · Done · #2 B · M2 · 2 pts'].join('\n');
  const ids = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];
  const plan = { milestones: ids.map((id, i) => ({ id, status: i < 2 ? 'done' : 'in progress' })) };
  const html = renderReports({ history, plan, builtAt: new Date(2026, 9, 2, 12, 0) });
  assert.match(html, /<span class="st st-open" title="M3, M4, M5 and M6 in progress">4 milestones in progress<\/span>/);
  assert.equal(html.match(/class="chart-rule"/g).length, 1);
  const few = renderReports({ history, plan: { milestones: [{ id: 'M1', status: 'in progress' }, { id: 'M2', status: 'in progress' }] }, builtAt: new Date(2026, 9, 2, 12, 0) });
  assert.match(few, /<span class="st st-open">M1 and M2 in progress<\/span>/);
});

test('time to build spaces 1 min, 10 min, 1 h and 8 h evenly, and bands the middle half of each size', () => {
  const lines = [[1, 10], [2, 60], [3, 60], [4, 480]].flatMap(([id, mins]) => {
    const end = new Date(2026, 9, 2, 0, mins);
    return [`- 2026-10-02 00:00 · Doing · #${id} C · M1 · 3 pts · develop`, `- 2026-10-02 ${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')} · Needs your look · #${id} C · M1 · 3 pts`];
  });
  const html = renderReports({ history: lines.join('\n'), plan: { milestones: [] }, builtAt: new Date(2026, 9, 2, 23, 0) });
  assert.deepEqual([...html.matchAll(/class="chart-y" style="top:([\d.]+)%">(\w+)</g)].slice(-4).map((m) => [m[2], Math.round(m[1])]), [['1m', 100], ['10m', 63], ['1h', 34], ['8h', 0]]);
  // The middle half of 10, 60, 60 and 480 minutes runs from 47.5 to 165 minutes.
  assert.match(html, /<span class="chart-spread" style="left:41\.67%;top:17\.3%;height:20\.17%"><\/span>/);
});

test("burn-up milestone labels never overlap: two rows, the newest first, and what can't fit is left out (#123)", () => {
  // 35 milestones, some ending together, like weatherglider's.
  const ends = Array.from({ length: 35 }, (_, i) => ({ id: `M${i + 1}`, x: Math.min(100, Math.round(i * 2.9)) }));
  ends.push({ id: 'M36', x: ends.at(-1).x });
  const span = (m, px) => {
    const w = ((m.text.length * 8.5 + 8) / px) * 100;
    return m.x < 8 ? [m.x, m.x + w] : m.x > 92 ? [m.x - w, m.x] : [m.x - w / 2, m.x + w / 2];
  };
  for (const px of [700, 260]) {
    const placed = placeMarks(ends, px);
    for (const row of [0, 1]) {
      const r = placed.filter((m) => m.row === row).map((m) => span(m, px)).sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < r.length; i++) assert.ok(r[i][0] >= r[i - 1][1], `labels overlap at ${px}px in row ${row}`);
    }
    assert.ok(placed.some((m) => m.ids.includes('M36') && m.ids.includes('M35')), 'the newest, ending together, share one label');
  }
  assert.ok(placeMarks(ends, 260).length < placeMarks(ends, 700).length, 'a phone shows fewer');
  const html = renderReports({ history: '- 2026-10-02 09:00 · Done · #1 A · M1 · 3 pts', plan: { milestones: [{ id: 'M1', status: 'done' }] }, builtAt: new Date(2026, 9, 2, 12, 0) });
  assert.match(html, /class="chart-mark mark-wide[^"]*"/);
  assert.match(html, /class="chart-mark mark-narrow[^"]*"/);
});
