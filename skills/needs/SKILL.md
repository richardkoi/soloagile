---
name: needs
description: Clear what waits on the user — ask every Needs your decision and Needs your look card as multiple choice, then move the cards and log the answers. Use when the user says "what needs me", "ask me the questions", "clear my waiting" or "clear out Waiting on you".
argument-hint: "[optional: card numbers, e.g. \"#12 #14\"]"
allowed-tools: Read, Edit, AskUserQuestion, Bash(soloagile board:*), Bash(soloagile card:*), Bash(soloagile archive:*), Bash(soloagile build:*), Bash(echo:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/soloagile:*)
---

The user wants their waiting list cleared. Cards they named, if any: **$ARGUMENTS**

Board, without its finished cards: !`"${CLAUDE_PLUGIN_ROOT}/bin/soloagile" board 2>/dev/null || echo "no pm/board.md"`

Page: !`"${CLAUDE_PLUGIN_ROOT}/bin/soloagile" link 2>/dev/null || echo "-"`

If there is no board, say so in one line and stop. The format and rules are in
`${CLAUDE_PLUGIN_ROOT}/SPEC.md`.

**Ask.** One question per card with AskUserQuestion, four questions to a call:
decisions first, then looks. Ask every waiting card in this one round, call after call,
before any other work: the user answers them together, not one at a time between steps. If the user named cards, ask only those. Skip a look dated
`from <a later day>`: it can't happen yet.
- The question names the card (`#12 …`) and says in a few words what to decide or
  check, with the link or command from the card's "to look" line.
- A decision card offers its own options, the recommended one first. Leave out its
  "something else" line, because the Other box is the open option. If it has more
  than four options, offer the first three and say the rest are under Other.
- A design card, one marked `· design`, is asked like a decision: which approach, with
  its own options.
- A card whose options have pictures (files in `pm/designs/` named `<card>-<letter>.png`)
  shows them in its pop-up on the page. Say in the question that the pictures are on the
  card, and give the page's link, so the user can look before answering.
- A look card offers "Yes, done", "Needs a change" and "Not looked yet".

**Apply** every answer before asking the next four, with `soloagile card`: `soloagile card
move <number> done` finishes a card and moves its text to `pm/finished-cards.md`,
`soloagile card move <number> doing` sends one back, and `soloagile card note <number>
"…" --first` gives it a new first line. Edit `pm/board.md` by hand only for what the
command can't do, such as taking a line out, and run `soloagile archive` after a hand
edit that finished a card.
- A look the user approved moves to Done, dated today, without its "to look" line.
- A decision they answered moves to Done, dated today. The answer goes at the top of
  `pm/decisions.md`: `## <today> · <the question>`, then `**Answer:**`, and `**Why:**`
  if they gave a reason.
- A design they chose goes back to Doing, marked `· develop` and with no date. The
  approach they chose replaces its options, as one detail line: `soloagile card choose
  <number> <letter>` writes it, then `soloagile card move <number> doing`. The answer goes
  in `pm/decisions.md` like a decision's.
- "Needs a change", or an answer that says what is wrong: ask what, if they haven't
  said. The card goes back to Doing, with a new first line saying what to fix.
- "Not looked yet" leaves the card where it is.

If that leaves a milestone with every card in Done and its "Done when" in `pm/plan.md`
met, say so and offer `/soloagile:retro`, which closes the milestone and writes its
release note.

Do not start any work here: no fixing what was flagged, no building what an answer
unblocks. This skill only asks and records.

Finish with one line per card: what the user said and where the card went. Then what is
still waiting, or "nothing", what the answers unblock, and the page's link, from the
Page line above.
