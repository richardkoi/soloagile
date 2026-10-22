// soloagile next: the board in a few lines, and the one move to make next. The catchup skill
// loads this instead of the whole board (#171), which is most of what a pickup used to read.
const cardsIn = (board, column) => board.columns.find((c) => c.name === column)?.cards ?? [];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const TOP = 5;

// What holds an Up next card back, from its "not before" line: a date still to come, or an
// event with no date (such as "the next time Rich uses the laptop"). Null when it can start.
function heldBy(card, today) {
  const line = card.details.find((d) => /^not before\b/i.test(d));
  if (!line) return null;
  const date = /^not before (\d{4}-\d{2}-\d{2})/i.exec(line)?.[1];
  if (date) return date > today ? { date } : null;
  return { event: line.replace(/^not before:?\s*/i, '') };
}

export function nextText(board, { name, today }) {
  const decide = cardsIn(board, 'Needs your decision');
  const looks = cardsIn(board, 'Needs your look').filter((c) => !(c.date?.label === 'from' && c.date.value > today));
  const doing = cardsIn(board, 'Doing');
  const next = cardsIn(board, 'Up next');

  const out = [`${name} · ${plural(decide.length, 'decision')}, ${plural(looks.length, 'look')}, ${doing.length} doing, ${next.length} up next`];
  if (decide.length || looks.length) {
    out.push('Waiting on you:', ...decide.map((c) => `- #${c.id} ${c.title} (decision)`), ...looks.map((c) => `- #${c.id} ${c.title} (look)`));
  }
  if (doing.length) out.push('Doing:', ...doing.map((c) => `- #${c.id} ${c.title}${c.stage ? ` (${c.stage})` : ''}`));
  if (next.length) {
    out.push(next.length > TOP ? `Up next (top ${TOP} of ${next.length}):` : 'Up next:');
    for (const c of next.slice(0, TOP)) {
      const held = heldBy(c, today);
      out.push(`- #${c.id} ${c.title}${held?.date ? ` (not before ${held.date})` : held ? ` (waits: ${held.event})` : ''}`);
    }
  }

  const free = next.find((c) => !heldBy(c, today));
  const dates = next.map((c) => heldBy(c, today)?.date).filter(Boolean).sort();
  const move = decide.length
    ? `ask the user about #${decide[0].id} (/soloagile:needs)`
    : looks.length
      ? `get the user's look on #${looks[0].id} (/soloagile:needs)`
      : doing.length
        ? `carry on with #${doing[0].id}${doing[0].stage ? `, at ${doing[0].stage}` : ''}`
        : free
          ? `start #${free.id} ${free.title}`
          : next.length
            ? `nothing can start${dates.length ? ` until ${dates[0]}` : ' yet'}; plan more in pm/plan.md`
            : 'plan the next milestone in pm/plan.md';
  out.push(`Next move: ${move}`);
  return out.join('\n');
}
