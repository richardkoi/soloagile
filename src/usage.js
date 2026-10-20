// soloagile usage: how much of the Claude usage is spent, for away mode (#139), so a long
// run stops before the week, or the 5 hours (#157), runs out. Nothing is known without a
// usage address: a person who runs a usage service names it once in ~/.soloagile/settings.json:
//   usageUrl    an address that answers with JSON, such as "http://127.0.0.1:8787/budget"
//   usagePath   where the week's percentage sits in that JSON, dotted: "windows.seven_day.used_pct"
//   usagePaths  several to watch, name to dotted path, used instead of usagePath:
//               { "week": "windows.seven_day.used_pct", "5 hours": "windows.five_hour.used_pct" }
//   usageStop   the percentage to stop at, for each of them; 98 unless set
import { readSettings } from './settings.js';

const dig = (json, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), json);

// { pct, pcts, stop, said }: pct is the highest of them, pcts each by name, and stop is
// true once any of them has reached the stop.
export async function readUsage(settings = readSettings(), get = fetch) {
  const limit = settings.usageStop ?? 98;
  const paths = settings.usagePaths ?? { week: settings.usagePath ?? 'used_pct' };
  if (!settings.usageUrl) return { pct: null, stop: false, said: 'no usage address set (usageUrl in ~/.soloagile/settings.json), so the week is not checked' };
  let json;
  try {
    const res = await get(settings.usageUrl, { signal: AbortSignal.timeout(5000) });
    json = await res.json();
  } catch (err) {
    return { pct: null, stop: false, said: `couldn't read ${settings.usageUrl}: ${err.message}` };
  }
  const pcts = {};
  const missing = [];
  for (const [name, path] of Object.entries(paths)) {
    const pct = Number(dig(json, path));
    if (Number.isFinite(pct)) pcts[name] = pct;
    else missing.push(path);
  }
  const names = Object.keys(pcts);
  const noNumber = missing.length ? `${settings.usageUrl} gave no number at ${missing.join(', ')}` : '';
  if (!names.length) return { pct: null, stop: false, said: noNumber };
  // "the week is 51% used, the 5 hours 77%"
  const told = names.map((n, i) => (i ? `the ${n} ${pcts[n]}%` : `the ${n} is ${pcts[n]}% used`)).join(', ');
  const past = names.filter((n) => pcts[n] >= limit);
  const stop = past.length > 0;
  const then = stop
    ? `${past.map((n) => `the ${n}`).join(' and ')} ${past.length > 1 ? 'are' : 'is'} past the ${limit}% stop, so stop after the card in hand`
    : `away mode stops at ${limit}%`;
  const pct = Math.max(...Object.values(pcts));
  return { pct, pcts, stop, said: `${told}; ${then}${noNumber ? `; ${noNumber}` : ''}` };
}
