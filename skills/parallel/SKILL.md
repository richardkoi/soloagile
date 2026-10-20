---
name: parallel
description: Build several cards at once — pick Up next cards that touch different files, give each its own helper working in its own copy of the code (a git worktree), then merge their work back, run the checks and move the cards. Use when the user says "build these in parallel", "use helpers", "several at once", or asks to speed up a run of independent cards.
argument-hint: "[optional: card numbers, e.g. \"#12 #14 #15\", or how many helpers]"
allowed-tools: Read, Glob, Grep, Agent, AskUserQuestion, Bash(soloagile board:*), Bash(soloagile card:*), Bash(soloagile set:*), Bash(soloagile cleanup:*), Bash(git status:*), Bash(git log:*), Bash(git diff:*), Bash(git merge:*), Bash(git worktree:*), Bash(git branch:*), Bash(echo:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/soloagile:*)
---

The user wants cards built in parallel. Cards or count they named, if any: **$ARGUMENTS**

Board, without its finished cards: !`"${CLAUDE_PLUGIN_ROOT}/bin/soloagile" board 2>/dev/null || echo "no pm/board.md"`

Habits: !`"${CLAUDE_PLUGIN_ROOT}/bin/soloagile" set 2>/dev/null || echo "-"`

Working tree: !`git status --short --branch 2>/dev/null || echo "not a git repo"`

If there is no board, or this is not a git repo, say so in one line and stop. If the
habits above list `parallel-helpers` as `off`, say so (`soloagile set parallel-helpers on`
turns it on) and stop. If the working tree has uncommitted changes, ask the user whether
to commit them first: a helper starts from the last commit, so it won't see them.

**1. Choose the cards.** The ones the user named, or else Up next cards in board order
that are ready: a "done when", and a chosen approach if they are 3 points or more. Read
each card and the code to work out which files it will change. Two cards that would
change the same file go to the same helper, one after the other, or wait for a later
round. Four helpers at most. Say in one line which cards go together.

**2. Note who owns what.** On each card: `soloagile card note <n> "helper: owns <files>"`,
and move it to Doing. Only you change the board: helpers never touch `pm/`.

**3. Start one helper per group, all in one message**, with the Agent tool and
`isolation: "worktree"`, so each works in its own copy of the code on its own branch.
Give each helper everything it needs, since it starts without this conversation: the
card's full text, the files it owns and may change (and that it must not change any
other), the project's checks, and to commit its work on its branch with a message naming
the card. Ask it to report the branch, what it changed, and its checks' result.

**4. Merge back, one helper at a time**, in board order: `git merge --no-ff <branch>`,
then run the project's checks. A merge that conflicts, or checks that fail: stop merging
that branch (`git merge --abort`), note what happened on the card, and move it to Needs
your decision. For each card that merged and passed: write its `tested:` and `to look:`
lines and move it to Needs your look.

**5. Clear up**: remove each merged helper's worktree and branch (`git worktree remove`,
`git branch -d`); `soloagile cleanup` also clears merged worktrees later.

Finish with one line per card: merged and waiting for the user's look, or why not.
