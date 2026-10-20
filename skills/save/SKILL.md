---
name: save
description: End-of-session handoff — tidy the board, update NEXT_SESSION.md, flag what's unverified, park open questions. Use when the user says they are finishing — "done for today", "wrap up", "save".
argument-hint: "[e.g. \"and push\" | \"back in 2 hours\" | \"shut down containers\"]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git status:*), Bash(git log:*), Bash(git diff:*), Bash(git branch:*), Bash(docker ps:*), Bash(docker compose ps:*), Bash(docker compose down:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(soloagile card:*), Bash(soloagile archive:*), Bash(soloagile build:*), Bash(soloagile backup:*), Bash(head:*), Bash(echo:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/soloagile:*)
---

The user is ending the session. Extra instructions from them: **$ARGUMENTS**

Current state:
- Branch and working tree: !`git status --short --branch 2>/dev/null || echo "not a git repo"`
- Commits this session: !`git log --oneline -12 2>/dev/null || echo "-"`
- Running containers: !`docker ps --format '{{.Names}}\t{{.Status}}' 2>/dev/null | head -10 || echo "-"`
- Page: !`"${CLAUDE_PLUGIN_ROOT}/bin/soloagile" link 2>/dev/null || echo "-"`

**If the project has `pm/board.md`, tidy the board first.** The format and rules are
in `${CLAUDE_PLUGIN_ROOT}/SPEC.md`.
- Move cards with `soloagile card move <number> <lane>`, and add a question with
  `soloagile card add "<the question>" --lane decision --milestone … --option "…"
  --option "…"`. It refuses a wrong move and says why.
- Check every card in Doing and Up next against this session's commits. Work that is
  live (deployed, or installed and running where the user uses it, for a local project)
  moves to Needs your look, dated `live <today>`. Built but not yet live stays in
  Doing, like unfinished work, and so does a Needs your look card that isn't live yet.
  A live look that the user can't do before a known day is dated `from <that day>`
  instead. Never move a card to Done — that takes the user's yes.
- Run `soloagile archive`. It moves every finished card's text to `pm/finished-cards.md`,
  leaves each one line in Done, and takes Done cards past their 48 hours off the board:
  one finished on 30 Sep stays through 2 Oct.
- Open questions become Needs your decision cards (the question as the title, one
  option per line, recommended first, an open option last) instead of going in QUESTIONS.md.
- Every address created this session (site, port, artifact, doc, repo) is in
  `pm/links.md`. Never a `file://` address: a file's path differs on every machine.
- A hook normally rebuilds the page. If `pm/index.html` is older than the Markdown,
  run `soloagile build`.

Write or update `NEXT_SESSION.md` in the project root so a fresh session with zero
context can pick this up cold. It must contain, in this order:

1. **The one thing to ask first.** Lead with whatever is genuinely blocked on the
   user — an untested fix they left before confirming, a decision only they can make.
   If nothing is blocked on them, say so in one line and move on. Never invent one.
2. **Where we are.** What this project is, and what state it's actually in right now.
3. **What changed this session.** Concrete: files, decisions, what was proven to work.
4. **What is NOT verified.** Anything shipped without a passing check, anything the
   user said they'd test and didn't. Be explicit — this is the part that costs time later.
5. **What's next**, as a numbered list, one sentence each, plain English. With a
   board, this is one line pointing at it instead: the tasks live only there.
6. **How to run and test it** — the exact commands, including env quirks.

Rules:
- Overwrite stale content; this is a handoff, not a changelog. Keep it under ~120
  lines, or ~60 with a board.
- Absolute dates, never "yesterday" or "last session".
- Without a board: if `QUESTIONS.md` exists or you have unanswered questions, append
  them there with today's date rather than burying them in the handoff.
- **Always commit and push the handoff files themselves** — `NEXT_SESSION.md`,
  `QUESTIONS.md`, the `pm/*.md` files (`pm/finished-cards.md` among them), and any session-history file you moved content
  into. Left dirty, they hide what the next session should trust, and a careful deploy
  refuses a dirty tree.
- Any *other* uncommitted work: only commit or push it if the user asked in the
  arguments above. Say plainly what you left uncommitted.
- Run `soloagile backup` last. It runs the project's own backup when `pm/settings.json`
  names one, and says so when there is none. Say what it reported.
- Only shut containers down if the user asked, or said they're away for hours — say
  what you stopped.

Finish with these lines and nothing else:
- **Next session, say:** a single sentence the user can paste back to restart cleanly.
- **Left hanging:** the one thing most likely to be forgotten, or "nothing".
- **Page:** in a project with `pm/`, its link on its own line, from the Page line
  above, so the user can open it. Leave this line out when there is no `pm/`.
