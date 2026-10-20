import { test } from 'node:test';
import assert from 'node:assert/strict';
import './isolate.js';
import { readUsage } from '../src/usage.js';

const answer = (json) => async () => ({ json: async () => json });

test("the week's usage: read from the address, a stop at 98% unless set, and plain words when it can't be read", async () => {
  const set = { usageUrl: 'http://u.test/budget', usagePath: 'windows.seven_day.used_pct' };
  assert.deepEqual(await readUsage(set, answer({ windows: { seven_day: { used_pct: 50 } } })), { pct: 50, stop: false, said: 'the week is 50% used; away mode stops at 98%' });
  assert.equal((await readUsage(set, answer({ windows: { seven_day: { used_pct: 98 } } }))).stop, true);
  assert.equal((await readUsage({ ...set, usageStop: 90 }, answer({ windows: { seven_day: { used_pct: 91 } } }))).stop, true);
  assert.match((await readUsage({}, answer({}))).said, /no usage address set/);
  assert.match((await readUsage(set, answer({}))).said, /gave no number/);
  assert.match((await readUsage(set, async () => { throw new Error('refused'); })).said, /couldn't read .*refused/);
});
