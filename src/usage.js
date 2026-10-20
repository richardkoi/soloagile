// soloagile usage: how much of the week's Claude usage is spent, for away mode (#139), so a
// long run stops before the week runs out. Nothing is known without a usage address: a
// person who runs a usage service names it once in ~/.soloagile/settings.json:
//   usageUrl    an address that answers with JSON, such as "http://127.0.0.1:8787/budget"
//   usagePath   where the percentage sits in that JSON, dotted: "windows.seven_day.used_pct"
//   usageStop   the percentage to stop at; 98 unless set
import { readSettings } from './settings.js';

const dig = (json, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), json);

// { pct, stop, said }: stop is true once the week has reached its stop.
export async function readUsage(settings = readSettings(), get = fetch) {
  const limit = settings.usageStop ?? 98;
  if (!settings.usageUrl) return { pct: null, stop: false, said: 'no usage address set (usageUrl in ~/.soloagile/settings.json), so the week is not checked' };
  try {
    const res = await get(settings.usageUrl, { signal: AbortSignal.timeout(5000) });
    const pct = Number(dig(await res.json(), settings.usagePath ?? 'used_pct'));
    if (!Number.isFinite(pct)) return { pct: null, stop: false, said: `${settings.usageUrl} gave no number at ${settings.usagePath ?? 'used_pct'}` };
    const stop = pct >= limit;
    return { pct, stop, said: `the week is ${pct}% used; ${stop ? `that is past the ${limit}% stop, so stop after the card in hand` : `away mode stops at ${limit}%`}` };
  } catch (err) {
    return { pct: null, stop: false, said: `couldn't read ${settings.usageUrl}: ${err.message}` };
  }
}
