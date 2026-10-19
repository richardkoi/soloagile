---
name: init
description: Give this project its page — board, plan, release notes, docs and links. A project with history gets them built from its handoff files. Use when the user says "give this project its page" or "set up soloagile here".
argument-hint: "[optional: what the project is for]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git status:*), Bash(git log:*), Bash(wc:*), Bash(ls:*), Bash(soloagile init:*), Bash(soloagile card:*), Bash(soloagile build:*), Bash(grep:*), Bash(echo:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/soloagile:*)
---

Set up this project's page. What the user said about the project: **$ARGUMENTS**

Result: !`"${CLAUDE_PLUGIN_ROOT}/bin/soloagile" init 2>&1`
Handoff files, with their length in lines: !`wc -l NEXT_SESSION.md QUESTIONS.md BUILD-BRIEF.md ROADMAP.md TODO.md 2>/dev/null | grep -v ' total$' || echo "none"`
OpenSpec changes: !`ls openspec/changes 2>/dev/null | grep -v '^archive$' || echo "none"`
Recent commits: !`git log -20 --date=short --format='%ad %h %s' 2>/dev/null || echo "-"`

If the result says "already set up", say so in one line and stop.

Otherwise, read the board and plan sections of `${CLAUDE_PLUGIN_ROOT}/SPEC.md`, then
fill in the starter files.

## A new project (no handoff files above)

Fill them from what the user has said about the project (this conversation, the
arguments above, the README):
- `pm/plan.md`: the `#` heading is the project's name as the page should show it,
  then one paragraph of goal and the first milestone, with a "Done when" the user can check.
- `pm/board.md`: cards for the first milestone only. That's one card per result the
  user would recognise, 3 to 8 cards, with titles of eight words or fewer and story
  points on each. Update `next-id`.
- `pm/overview.md`: only what's known so far.

## A project with history (handoff files above)

Build the page from those files, so nothing the user is waiting on is lost and nothing
stale is carried over.

**Read cheaply.** In a file over 300 lines, read the headings and the newest sections,
not all of it. The sources: `NEXT_SESSION.md`, `QUESTIONS.md`, any plan or task file
they or the project's CLAUDE.md name (it may live outside the repo), `README.md`,
`DEPLOYMENT.md`, and the commits above.

- `pm/plan.md`: the name, a one-paragraph goal, the out-of-scope list if the project
  has one, and its phases as milestones with their real status, each with a `short:`
  line of 2 to 4 words. A finished phase is one line, plus its `short:` line. With no
  phases, make one milestone for the work in hand.
- `pm/board.md`: only what is open now, each card with story points.
  - Needs your decision: every unanswered question, one option per line, the
    recommended one first and an open one last.
  - Needs your look: finished work waiting for the user to check it, if it is live.
    Date it `from <date>` if they can't check it before a known day.
  - Doing: work that is part done, or built and not yet live.
  - Up next: the "what's next" list, in its order, eight cards at most.
  - Ideas: the "later" and "maybe" items, each with the closest milestone. When none
    fits, add a milestone for them, as `not started`, with its `short:` line.
  - Done: only what finished in the last 48 hours.
  - With OpenSpec changes above: one card per change. Its `tasks.md` stays the detail.
- `pm/releases.md`: the last deploys or finished phases, newest first, five at most.
  Don't rebuild older history.
- `pm/decisions.md`: the questions the user has answered that still shape the work,
  newest first, ten at most.
- `pm/links.md`: the live site, the repo, local addresses and ports, and any artifact
  or doc those files name.
- `pm/overview.md`: what it is, how to run it and how it's built, from the README.

Then make the board the only task list:
- `NEXT_SESSION.md` shrinks to a short note that points at the board. Take out its
  task and question lists once they are cards.
- `QUESTIONS.md` is deleted once every open question is a card and every answer that
  still matters is in `pm/decisions.md`.
- A line in the project's CLAUDE.md or DEPLOYMENT.md that tells Claude to update one
  of the old lists now points at `pm/`.

## Either way

Don't invent a goal, a milestone or a status the user hasn't given. Where the files
disagree or don't say, leave the starter text in place and name it at the end.

Finish with the page link from the result, how many cards went in each column, and one
line naming anything left as starter text or that you couldn't place.
