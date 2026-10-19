---
name: commit
description: Review the diff, run the project's checks, then commit and push. Use when the user says "commit", "commit it", "commit this" or "push it". Not "ship it": that means deploy.
argument-hint: "[optional commit message or scope]"
allowed-tools: Read, Edit, Glob, Grep, Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(soloagile card:*), Bash(npm test:*), Bash(pytest:*), Bash(uv run:*), Bash(npx tsc:*), Bash(ruff:*), Bash(tail:*)
---

What the user said: **$ARGUMENTS**

State:
- !`git status --short --branch`
- Changed files: !`git diff --stat HEAD 2>/dev/null | tail -20`
- Recent messages for style: !`git log --oneline -8 2>/dev/null`

Do this in order, and stop at the first thing that fails:

1. **Read the actual diff.** Not the file list — the diff. Flag anything that
   doesn't belong in this commit: debug prints, commented-out code, secrets, a
   stray refactor. Say what you found before proceeding.
2. **Run the project's checks.** Find them yourself — `pytest`, `npm test`,
   `tsc --noEmit`, `ruff`, whatever this repo actually uses. If there are none,
   say so plainly rather than skipping quietly. Report real output. Do not
   commit over failing checks unless the user tells you to.
3. **Update the board**, if the project has `pm/board.md`: a card this commit
   finishes moves to Needs your look (`soloagile card move <number> look`, after its
   `tested:` line is on it), only if its work is already live where the user uses it. Work that still has to be deployed stays in
   Doing; the deploy moves it. Include the `pm/*.md` changes in the commit.
4. **Commit.** Match the style of the recent messages above. Subject line says
   what changed and why, not which files moved. If the user gave a message in the
   arguments, use their wording.
5. **Push**, unless you are on the default branch and they didn't ask for it — in
   that case branch first and say so.

Deploying is a separate step and is **not** part of this skill. If the user asked to
deploy in the arguments, follow the project's own deploy steps (its `DEPLOYMENT.md`
or README), and say which target you think they mean and confirm before touching it.

Finish with one line: what was committed, whether it was pushed, and what the
checks actually said.
