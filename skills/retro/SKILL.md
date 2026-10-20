---
name: retro
description: End-of-milestone retro, the wheel's Feedback stage — Claude drafts what worked, what to change and what's next from the milestone's cards, decisions and commits, and the user picks. Use when a milestone's last card is approved, or the user says "retro", "run the retro" or "look back at the milestone".
argument-hint: "[optional: the milestone, e.g. \"M7\"]"
allowed-tools: Read, Edit, AskUserQuestion, Bash(soloagile board:*), Bash(soloagile finished:*), Bash(soloagile card:*), Bash(soloagile rule:*), Bash(cat pm/plan.md:*), Bash(git log:*), Bash(soloagile build:*), Bash(echo:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/soloagile:*)
---

The user wants a milestone's retro. The milestone they named, if any: **$ARGUMENTS**

Board, without its finished cards: !`"${CLAUDE_PLUGIN_ROOT}/bin/soloagile" board 2>/dev/null || echo "no pm/board.md"`

Plan: !`cat pm/plan.md 2>/dev/null || echo "no pm/plan.md"`

Recent commits: !`git log --date=short --format='%ad %h %s' -40 2>/dev/null || echo "-"`

Page: !`"${CLAUDE_PLUGIN_ROOT}/bin/soloagile" link 2>/dev/null || echo "-"`

If there is no board, say so in one line and stop. The format and rules are in
`${CLAUDE_PLUGIN_ROOT}/SPEC.md`.

**Which milestone.** The one the user named. Otherwise the one `in progress` with no card
in the lanes above: all of its cards are finished. If a card of it is still open, name
the card and stop: a retro closes a finished milestone.

**Read** before drafting: the milestone's cards and their detail lines, which
`soloagile finished <milestone>` prints in full (such as `soloagile finished M7`), its entries in
`pm/decisions.md` and `pm/releases.md`, the commits above, and the "NOT verified" list
in `NEXT_SESSION.md`.

**Draft** four parts from what you read. Each point is one plain line of twelve words or
fewer, and comes from something that happened, not a general truth:
- **Open questions**: what is still unverified or undecided. Up to four.
- **What worked**: up to four.
- **What to change**: up to four. Each names the change, not the complaint.
- **What's next**: up to four things the next milestone could hold, taken from the
  Ideas lane, the plan's later milestones, its out-of-scope list and the open questions.

**Ask**, with AskUserQuestion:
1. The open questions first, each as its own question with two to four options and the
   recommended one first, four questions to a call. Put each answer at the top of
   `pm/decisions.md` as a decision. One the user can't answer yet becomes a Needs your
   decision card.
2. Then one call with three questions, each `multiSelect`: "What worked?", "What should
   change?" and "What's next?". The options are your drafted points; the Other box is
   for the user's own. They pick the ones they agree with.

**Apply**:
- The retro goes at the top of `pm/decisions.md`: `## <today> · Retro: <milestone and
  its name>`, then `**Worked:**`, `**Change:**` and `**Next:**`, each with the user's
  picks and their own words.
- Each change they picked becomes an Ideas card (`soloagile card add "…" --lane ideas
  --milestone … --points …`), with points and the closest milestone.
  When none fits, add a milestone for it in `pm/plan.md`, as `not started`, with its
  `short:` line.
- Each change they picked also becomes a standing rule in the project's `CLAUDE.md`, said
  as what to do, tagged with this retro and the card that showed the need: `soloagile rule
  "<the rule>" --from "retro of M3, #12"`. It numbers the rule, and writes nothing when the
  retro-rules habit is off.
- Their "what's next" picks become the next milestone in `pm/plan.md`, as `not started`:
  a name, a line on why, a numbered list of the cards-to-be with points, and a "Done
  when". No cards yet: they are made when the milestone starts. If they picked nothing,
  add no milestone and say so.
- Close the milestone if it is still open: set it to `done <today>` in `pm/plan.md`,
  and write its release note in `pm/releases.md`, listing only the cards that shipped
  in it.

Do not start any work here: no building what a change asks for, and no starting the
next milestone. This skill only asks and records.

Finish with one line per part saying what the user picked, then the next milestone's
name, and the page's link, from the Page line above.
