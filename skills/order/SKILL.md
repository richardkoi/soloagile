---
name: order
description: Choose the order of work with the user — Claude drafts an order for the open milestones and the Up next cards, with a reason for each, the user picks, and the order is applied. Use when the user says "what order", "reorder", "prioritise", "what should come first" or "sort out the order".
argument-hint: "[optional: what matters most now, e.g. \"the phone fixes first\"]"
allowed-tools: Read, Edit, AskUserQuestion, Bash(soloagile board:*), Bash(soloagile card:*), Bash(soloagile milestone:*), Bash(soloagile next:*), Bash(grep:*), Bash(echo:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/soloagile:*)
---

The user wants to choose the order of work. What they said matters most, if anything: **$ARGUMENTS**

Board, without its finished cards: !`"${CLAUDE_PLUGIN_ROOT}/bin/soloagile" board 2>/dev/null || echo "no pm/board.md"`

Milestones, in the order they are built: !`grep -E "^### M[0-9]+" pm/plan.md 2>/dev/null || echo "no pm/plan.md"`

Page: !`"${CLAUDE_PLUGIN_ROOT}/bin/soloagile" link 2>/dev/null || echo "-"`

If there is no board, say so in one line and stop. The format and rules are in
`${CLAUDE_PLUGIN_ROOT}/SPEC.md`. The order of milestones in `pm/plan.md` is the order
they are built in, and Up next is grouped by it; inside a group, a card's place is its
build order. The next move starts the first Up next card nothing holds.

**Draft.** Work out a recommended order for the milestones that aren't done, then for the
Up next cards. Read `pm/plan.md` for each open milestone's text first. Give every
milestone and card a reason of a few words, from these, in this order of weight:
- what it needs first: a card or milestone it leans on, a "comes first" line, a
  `not before` date (a held card goes after the ones that can start);
- what the user asked for, today or most recently, and what they said matters now;
- what unblocks most, or is closest to done;
- small before big, when nothing else decides.

Say in one line if the order you recommend is the one already there.

**Ask**, in one AskUserQuestion call: one question for the milestones, if two or more are
open, and one for Up next, if it holds two or more cards. Each offers, in this order:
- the recommended order (label it "(Recommended)"), its preview the numbered list with
  each reason;
- the order as it stands now, so nothing changes;
- one other order worth having, if there is a real one, such as biggest value first.
The Other box is the open answer: the user can say their own order.

**Apply** the pick, milestones first, because a milestone move regroups Up next:
- Milestones: `soloagile milestone move <first> --before <the first open one now>`, then
  each next one `--after` the one before it. Leave the done milestones where they are.
- Cards: `soloagile card move <first> --top`, then each next one `--after` the one
  before it. Send the moves as one command joined with `&&`.
- Log it at the top of `pm/decisions.md`: `## <today> · The order of work`, then
  `**Answer:**` with the order picked, and `**Why:**` if the user gave a reason.

A plain "put #12 first" needs no draft: run `soloagile card move 12 --top` and say where
it went.

Do not start building here. Finish with the new order in one line each for milestones and
Up next, the next move from `soloagile next`, and the page's link, from the Page line above.
