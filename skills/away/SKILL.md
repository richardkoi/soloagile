---
name: away
description: Away mode — ask every waiting question first, then build the board's Up next cards one after another while the user is gone, and save at the end. Use when the user says they are leaving for a while — "I'm off to bed", "going to lunch", "I'll be out", "work while I'm away", "keep going while I'm gone".
argument-hint: "[optional: how long, or which cards, e.g. \"back at 9\" or \"only M16\"]"
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion, Bash(soloagile board:*), Bash(soloagile card:*), Bash(soloagile usage:*), Bash(soloagile set:*), Bash(soloagile build:*), Bash(git status:*), Bash(git log:*), Bash(git diff:*), Bash(git add:*), Bash(git commit:*), Bash(echo:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/soloagile:*)
---

The user is going away. What they said about it: **$ARGUMENTS**

Board, without its finished cards: !`"${CLAUDE_PLUGIN_ROOT}/bin/soloagile" board 2>/dev/null || echo "no pm/board.md"`

Habits: !`"${CLAUDE_PLUGIN_ROOT}/bin/soloagile" set 2>/dev/null || echo "-"`

The week's usage: !`"${CLAUDE_PLUGIN_ROOT}/bin/soloagile" usage 2>/dev/null || echo "-"`

Page: !`"${CLAUDE_PLUGIN_ROOT}/bin/soloagile" link 2>/dev/null || echo "-"`

If there is no board, say so in one line and stop. If the habits above list `away-mode`
as `off`, say that away mode is switched off (`soloagile set away-mode on` turns it on) and
stop. The format and rules are in `${CLAUDE_PLUGIN_ROOT}/SPEC.md`.

**1. Ask everything now, while the user is still here.** One round, four questions to an
AskUserQuestion call, before any building:
- every Needs your decision card, as the needs skill asks them (`/soloagile:needs`);
- every Needs your look card, with "Yes, done", "Needs a change" and "Not looked yet";
- the design of every Up next card of 3 points or more that has no chosen approach: write
  its options on the card first (`soloagile card note <n> "a) …"`), with a picture of
  each for anything visual (`soloagile design`), then ask it like a design card.
Record each answer as the needs skill does. A card whose design is still unanswered when
the user leaves stays in Up next with its options, as a design card, and is skipped.

**2. Say the plan in one line**: the cards you will build, in board order, and when you
will stop. Then work without asking anything more.

**3. Build Up next in order**, one card at a time, round the whole wheel: move it to
Doing, build it, run the project's checks, write its `tested:` line and a `to look:` line,
commit it, and move it to Needs your look. Then the next card.
- Skip a card that needs the user: an unanswered design, a deploy to a live server, a
  purchase, an account, anything only they can approve. It waits in Needs your decision,
  with the question written on it.
- A card that fails its checks twice, or turns out bigger than its points: leave a line
  on it saying what was found, move it to Needs your decision, and go on to the next.
- While something slow runs, such as a long test or build, start the next card that
  can't disturb it.
- Between cards, run `soloagile usage`. It prints the week's usage when a usage address
  is set, and exits 3 when the week has reached its stop (98% unless set).

**4. Stop** when Up next has nothing left you can build, when `soloagile usage` says stop,
or at the time the user gave. Finish the card in hand first. Then run the save skill
(`/soloagile:save`), so the board, the handoff note and the commits are left in order.

Finish with what the user will want first when they are back: how many cards are waiting
for their look, each in one line with its `to look:` line; what was skipped and why; and
the page's link, from the Page line above.
