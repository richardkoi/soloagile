# soloagile rules

This project has a soloagile page: a board, plan, reports, release notes, docs and links,
kept in `pm/`. Follow these rules while you work here.

## The board
- `pm/board.md` is the only task list. `NEXT_SESSION.md` is a short note that points at it.
- Change the board with `soloagile card`, run in the project's folder. It numbers the card,
  checks it and rebuilds the page. A wrong move is refused with the reason, and nothing is
  written:
  - `soloagile card add "<title>" --milestone M3 --points 3 --done-when "…"` adds to Up
    next; `--lane ideas`, `doing` or `decision` picks another lane
  - `soloagile card move <number> doing`, `look`, `decision`, `done`, `next` or `ideas`;
    `soloagile card move <number> doing test` changes a Doing card's stage
  - `soloagile card note <number> "tested: …"` adds a detail line; `card set <number>
    --milestone M3` changes its milestone, points or title; `card show <number>` prints it
  `soloagile card` alone lists every form. Edit `pm/board.md` by hand only for what the
  command can't do, such as rewording a line.
- Keep the board live. Move a card the moment its state changes:
  - starting it → Doing
  - live (deployed, or running where the user uses it) → Needs your look
  - blocked on the user → Needs your decision
  - only the user's yes moves a card to Done. A finished card keeps one line on the board,
    and its text goes to `pm/finished-cards.md`: `soloagile card move <number> done` does
    both. After moving one by hand, run `soloagile archive`
- To read a finished card in full, run `soloagile finished <card number or milestone>`.
  To read the board without its finished cards, run `soloagile board`.
- A Doing card's line ends with its stage, such as `· 3 pts · test`: `design`, `develop`,
  `test` or `release`. Change the word as the work moves on. Cards in other lanes have none.
- Every new card gets story points, a quick size guess written `· 3 pts` on its line: 1, 2,
  3, 5, 8 or 13, where 13 means split it. Decision cards get none.
- Every new work card gets a guessed build time too, `--guess 40`, shown as `· ~40 min`.
  Make it from the build times the session start gives you (`soloagile sizes` prints them
  again): the usual time for its size, moved up or down by how it compares with the examples.
- Habits the session start lists come from soloagile's settings: follow each one that is
  on, and skip each one that is off. When the user asks to switch one, run
  `soloagile set <habit> on|off` in the project, with `--all` for every project.
- Every new card gets a milestone, written `· M3` on its line, an idea too: the closest one
  in `pm/plan.md`. When none fits, add a milestone for it there, as `not started`.
- Every milestone has a `short:` line under its heading: 2 to 4 words saying what it is,
  such as `short: Public plugin`. Its chips on the page show them.
- Every address you create (site, port, artifact, doc, repo) goes in `pm/links.md` straight
  away. Never a `file://` address.
- `pm/index.html` is built from the Markdown: never edit it. A hook rebuilds it after an
  edit, and `soloagile build` does it by hand.

## The wheel
Every card goes round six stages: **Plan → Design → Develop → Test → Release → Feedback**.
- **Plan**: a card with a title, points, a milestone and a "done when" line. When a plan
  leans on a fact from docs, try it for real first. When a milestone can only be proven in
  a special set-up, such as a clean machine, setting that up is its first card.
- **Design**: the approach, before any code. 1 or 2 points: say it in one line and carry
  on. 3 points or more: move the card to Needs your decision as a design card
  (`· 5 pts · design · asked <date>`, with the options under it), then ask the user. For
  anything visual, give each option a real picture: write a small HTML mock-up of each and
  run `soloagile design <card number> <option letter> <mock-up.html>`. The user's yes moves
  the card to Doing as `· develop`.
- **Develop**: build it. If the build departs from the option the user picked, say so at
  once, not at their look.
- **Test**: the project's checks. For anything seen in a browser, then run
  `soloagile shots <url>` and read its four screenshots: desktop and phone width, dark and
  light. Write a `tested:` line on the card saying what was checked. A card reaches the
  user already tested.
- **Release**: commit the card's work, without waiting to be asked, before the card moves
  to Needs your look. Deploy where the project has a server, and write the release note.
- **Feedback**: the user's look on the card. When a milestone's last card is approved, run
  `/soloagile:retro`.

## Questions
- Ask the user as multiple choice, with an open option.
- A question that can wait becomes a Needs your decision card: one option per line, the
  recommended one first and an open one last. The answer goes in `pm/decisions.md`.

## The session
- Plain words run the skills: "catch me up" → `/soloagile:catchup`, "commit" →
  `/soloagile:commit`, "what needs me" → `/soloagile:needs`, "done for today" →
  `/soloagile:save`, "retro" → `/soloagile:retro`.
- Read `NEXT_SESSION.md` when a session starts, if it exists, and update it before one ends.

The format of every file, and each rule in full: `{{spec}}`.
