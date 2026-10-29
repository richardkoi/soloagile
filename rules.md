# soloagile rules

This project has a soloagile page (board, plan, reports, release notes, docs, links), kept
in `pm/`. Follow these rules while you work here.

## The board
- `pm/board.md` is the only task list. `NEXT_SESSION.md` is a short note pointing at it.
- Change it with `soloagile card`, in the project's folder: it numbers, checks and rebuilds,
  and refuses a wrong move with the reason. `card add "<title>" --milestone M3 --points 3
  --guess 40 --done-when "…"` (`--lane` for another lane); `card move <n> doing|look|
  decision|done|next|ideas` (`doing test` sets a stage, `decision --option "…" --option "…"`
  adds options); `card note <n> "tested: …"`;
  `card set`, `show`, `choose <n> b`, `reword`, `unnote`, `drop <n> "why"`. `soloagile card`
  lists every form. Edit `pm/board.md` by hand only for what it can't do.
- Send card commands in the same turn as other work, never a turn of their own: each turn
  re-reads the whole conversation. Join them with `&&` beside the next test, build or commit.
- A card note is one short line, under about 100 characters, with the detail in the commit message.
- Keep the board live: Doing when a card's own build starts, one at a time; Needs your look
  once live (deployed, or running where the user uses it); Needs your decision when blocked
  on the user. Only the user's yes moves a card to Done.
- `soloagile board` prints the board without finished cards; `soloagile finished <n or M3>`
  prints finished ones in full.
- A Doing card ends with its stage: `design`, `develop`, `test` or `release`.
- Every new card gets points (1, 2, 3, 5, 8, 13 = split it; none on a decision), a guessed
  build time from the build times below, and a milestone from `pm/plan.md`. With none
  fitting, add one there as `not started`. A card that comes after a milestone's work is
  done goes in a new milestone, not the open old one. A milestone has a `short:` line of 2
  to 4 words and a `Cards:` line naming its cards.
- Follow each habit listed below that is on; `soloagile set <habit> on|off [--all]` switches one.
- Every address you create (site, port, artifact, doc, repo) goes in `pm/links.md` at once,
  never as `file://`.
- Never edit `pm/index.html`: it is built from the Markdown.

## The wheel: Plan → Design → Develop → Test → Release → Feedback
- **Plan**: title, points, milestone and a "done when" that names only projects on this
  machine. When a plan leans on a fact from docs, try it for real first. When a milestone
  can only be proven in a special set-up, setting that up is its first card.
- **Design**: 1 or 2 points, say the approach in a line and carry on. 3 or more, make it a
  design card in Needs your decision with options and ask; for anything visual, give each
  option a picture with `soloagile design <n> <letter> <mock-up.html>`.
- **Develop**: if the build departs from the option the user picked, say so at once.
- **Test**: run the checks listed under `## Checks` in `pm/overview.md`, and write a
  `tested:` line saying only what ran; what didn't goes on a `not tested:` line. For
  anything in a browser, run `soloagile shots <url>` and read its pictures; the phone shots are taken
  before the card moves to Needs your look. A new chart is checked on a busy project too.
  A new skill is run once for real, and its `tested:` line says what it did.
- **Release**: commit without being asked, before Needs your look. Deploy where there's a
  server, and write the release note.
- **Feedback**: the user's look. When a milestone's last card is approved, run
  `/soloagile:retro`. A check that needs days to pass becomes a follow-up card with a
  `not before <date>` line, and doesn't hold the card open.

## Questions and the session
- Ask as multiple choice with an open option. A question that can wait becomes a Needs
  your decision card, recommended option first, an open one last; answers go in
  `pm/decisions.md`.
- Plain words run the skills: "catch me up" catchup, "commit" commit, "what needs me"
  needs, "done for today" save, "retro" retro, "I'm off to bed" away, "build these in
  parallel" parallel (each `/soloagile:<name>`).
- Read `NEXT_SESSION.md` when a session starts, and update it before one ends.

The format of every file, and each rule in full: `{{spec}}`.
