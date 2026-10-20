import { test } from 'node:test';
import assert from 'node:assert/strict';
import './isolate.js';
import { readUsage } from '../src/usage.js';

const answer = (json) => async () => ({ json: async () => json });

test("the week's usage: read from the address, a stop at 98% unless set, and plain words when it can't be read", async () => {
  const set = { usageUrl: 'http://u.test/budget', usagePath: 'windows.seven_day.used_pct' };
  assert.deepEqual(await readUsage(set, answer({ windows: { seven_day: { used_pct: 50 } } })), { pct: 50, pcts: { week: 50 }, stop: false, said: 'the week is 50% used; away mode stops at 98%' });
  assert.equal((await readUsage(set, answer({ windows: { seven_day: { used_pct: 98 } } }))).stop, true);
  assert.equal((await readUsage({ ...set, usageStop: 90 }, answer({ windows: { seven_day: { used_pct: 91 } } }))).stop, true);
  assert.match((await readUsage({}, answer({}))).said, /no usage address set/);
  assert.match((await readUsage(set, answer({}))).said, /gave no number/);
  assert.match((await readUsage(set, async () => { throw new Error('refused'); })).said, /couldn't read .*refused/);
});

test('the 5 hours as well as the week: each named, and a stop when either reaches it (#157)', async () => {
  const set = { usageUrl: 'http://u.test/budget', usagePaths: { week: 'windows.seven_day.used_pct', '5 hours': 'windows.five_hour.used_pct' } };
  const both = (week, five) => answer({ windows: { seven_day: { used_pct: week }, five_hour: { used_pct: five } } });
  assert.deepEqual(await readUsage(set, both(51, 77)), { pct: 77, pcts: { week: 51, '5 hours': 77 }, stop: false, said: 'the week is 51% used, the 5 hours 77%; away mode stops at 98%' });
  const five = await readUsage(set, both(51, 98));
  assert.equal(five.stop, true);
  assert.equal(five.said, 'the week is 51% used, the 5 hours 98%; the 5 hours is past the 98% stop, so stop after the card in hand');
  assert.equal((await readUsage(set, both(99, 10))).stop, true);
  assert.match((await readUsage(set, both(99, 99))).said, /the week and the 5 hours are past/);
  assert.equal((await readUsage({ ...set, usageStop: 80 }, both(51, 81))).stop, true);
  // one missing still checks the other, and says which gave nothing
  const half = await readUsage(set, answer({ windows: { five_hour: { used_pct: 98 } } }));
  assert.equal(half.stop, true);
  assert.match(half.said, /gave no number at windows\.seven_day\.used_pct/);
});
