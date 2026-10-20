import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHistory } from '../src/history.js';
import { sizeTable, sizesText } from '../src/sizes.js';

// A card that spent `minutes` in Doing before reaching the user's look.
let clock = 0;
function built(id, title, points, minutes) {
  const at = (m) => {
    const d = new Date(Date.UTC(2026, 9, 1, 0, clock + m));
    return d.toISOString().slice(0, 16).replace('T', ' ');
  };
  const pts = `${points} pt${points === 1 ? '' : 's'}`;
  const lines = [`- ${at(0)} · Doing · #${id} ${title} · M1 · ${pts} · develop`, `- ${at(minutes)} · Needs your look · #${id} ${title} · M1 · ${pts}`];
  clock += minutes + 10;
  return lines;
}
const history = (...cards) => parseHistory(cards.flat().join('\n'));

test('each size: its usual time, how many cards, and the two closest to usual as examples', () => {
  const rows = sizeTable(
    history(
      built(1, 'Small fix', 1, 10),
      built(2, 'Tiny note', 1, 20),
      built(3, 'Quick rule', 1, 90),
      built(4, 'A chart', 3, 40),
      built(5, 'Moved after', 2, 1),
    ),
  );
  assert.deepEqual(rows, [
    { size: 1, usual: 20, count: 3, examples: [{ id: 2, title: 'Tiny note', minutes: 20 }, { id: 1, title: 'Small fix', minutes: 10 }] },
    { size: 3, usual: 40, count: 1, examples: [{ id: 4, title: 'A chart', minutes: 40 }] },
  ]);
});

test('the text Claude reads: one line per size, and a plain line with no history', () => {
  const text = sizesText(history(built(1, 'Small fix', 1, 10), built(2, 'Tiny note', 1, 20), built(4, 'A chart', 3, 150)));
  assert.match(text, /^Build times from this project's finished cards/);
  assert.match(text, /\n- 1 pt: usually 15 min \(2 cards\), such as #1 Small fix \(10 min\) and #2 Tiny note \(20 min\)/);
  assert.match(text, /\n- 3 pts: usually 2\.5 h \(1 card\), such as #4 A chart \(2\.5 h\)/);
  assert.match(sizesText([]), /No finished cards yet/);
  const long = sizesText(history(built(9, 'x'.repeat(80), 2, 30)));
  assert.match(long, /#9 x{59}… \(30 min\)/, 'a long title is cut');
});
