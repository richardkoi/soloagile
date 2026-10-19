---
name: catchup
description: Start-of-session pickup — read the board and NEXT_SESSION.md, check what changed, offer next steps as choices. Use when the user says "catch me up", "where were we" or "what's next", or greets you at the start of a session.
argument-hint: "[optional: what you want to work on this session]"
allowed-tools: Read, Glob, Grep, Bash(git status:*), Bash(git log:*), Bash(git branch:*), Bash(docker ps:*), Bash(ls:*), Bash(soloagile board:*), Bash(soloagile finished:*), Bash(head:*), Bash(echo:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/soloagile:*)
---

The user is back. What they want from this session, if they said: **$ARGUMENTS**

Ground truth before you read anything:
- Working tree: !`git status --short --branch 2>/dev/null || echo "not a git repo"`
- Recent commits: !`git log --oneline -15 --date=short --format='%ad %h %s' 2>/dev/null || echo "-"`
- Containers up: !`docker ps --format '{{.Names}}\t{{.Status}}' 2>/dev/null | head -10 || echo "none"`
- Board, without its finished cards: !`"${CLAUDE_PLUGIN_ROOT}/bin/soloagile" board 2>/dev/null || echo "no pm/board.md"`
- Page: !`"${CLAUDE_PLUGIN_ROOT}/bin/soloagile" link 2>/dev/null || echo "-"`

Read `NEXT_SESSION.md` in the project root. If there is no board above, read
`QUESTIONS.md` too if it exists.
If there is no `NEXT_SESSION.md`, say so plainly and reconstruct the picture from
the board, the git log and the repo instead — don't pretend the handoff exists.

**If the project has a board, it is the task list.** NEXT_SESSION.md is only the
story around it, so points 3 and 4 come from the board.

Then give the user, and nothing more:

1. **Where we left off** — three sentences, plain English, no jargon.
2. **Did anything move since?** Compare the handoff and the board against the git log
   and working tree. Call out drift explicitly: uncommitted changes, commits the handoff
   doesn't mention, containers running that shouldn't be, cards in Doing that the log
   shows finished. If nothing drifted, one line saying so.
3. **Blocked on you** — with a board: the Needs your decision cards (question and
   options), then the Needs your look cards. A decision card marked `· design` is a
   design waiting for the user's yes: say so. A look dated `from <a later day>` can't
   happen yet: name it last, in one line, as not waiting. Without a board: whatever
   the handoff flagged as needing an answer. Or "nothing".
4. **What's next** — with a board: the Doing cards, then Up next, one line each with
   its #id. Without one: the handoff's options. A numbered list, one sentence each.

With a board, end with the page's link, from the Page line above.

Then stop and ask what to work on, using multiple-choice options. With cards
waiting on the user, make "answer what's waiting", which runs `/soloagile:needs`, one
of them. With no board, make "give this project its page", which runs
`/soloagile:init`, one of them. Ask unless they already told you at the top of this
prompt — in which case skip the question and start.

Do not begin editing code in this response. This is orientation.
