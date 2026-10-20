# soloagile — Spec

How the `pm/` convention works: the files, their format, and when they change.
In each project, the user's decisions are in `pm/decisions.md`, and the goal, milestones
and out-of-scope list are in `pm/plan.md`.

## What this is

A private page for every project a person builds with Claude. It shows six things:
the **board** (kanban), the **plan**, **reports** (charts), the **release notes**,
**brief docs**, and **links** to everything Claude creates.
Claude keeps it current as the work happens; the user reads it on a desktop or a phone.

## How it works

- **Folder `pm/` in each repo.** The page is `pm/index.html`. It is generated and
  git-ignored, because rebuilding a committed HTML file would dirty the tree, and
  a careful deploy refuses a dirty tree.
- **The page is view-only.** To change anything, tell Claude.
- **The page follows one design system, "My Board":**
  - an olive-and-parchment palette, dark by default, with a Dark/Light toggle
    that each browser remembers
  - system fonts, and borders rather than fills
  - uppercase lane headers, pills for states, and a key at the foot
  - text 2px larger than that system, for easy reading
- **On the desktop the lanes run in flow order:** Ideas, Up next, Doing, Waiting on you,
  Done. A card moves left to right, the way its stage bar fills. On a phone or a narrow
  window, where the lanes stack, Waiting on you comes first, then Doing, Up next, Ideas
  and Done.
- **The board shows five lanes:**
  - **Waiting on you**: decisions and designs first, then looks. This is the one lane
    with a coloured rail.
  - Doing, Up next, Ideas and Done.
- **Cards are shaded by lane.** Each gets a light tint and a left rail in its lane's
  colour, from My Board's colour-blind-safe palette:
  - Decide is amber and Look is pink.
  - Doing is orange, Up next is blue, Ideas is purple and Done is green.
- **A card shows one short line, and opens in a modal.** Clicking a card with a
  description shows all of it, at a larger size. Esc, the close button or a click
  outside shuts it. It uses the browser's Popover API, so it needs no script. Long
  descriptions on the card itself made the board slow to read.
- **A "?" in the header opens the command guide**, on every project's page and the home
  page. It is one list, in the order of a session: what the user says, what it does, and
  the typed command beside it. It opens as a card does, with no script, and is written
  once, in `template/guide.html`.
- **Browser tabs read `<project> - PM`, with their own icon**, so a project's page is
  easy to tell from the app itself. The icon is a small kanban board, inline in the
  page.
- **Cards carry story points**, Claude's quick guess at a card's size, made when the
  card is created. The chip is coloured by size, in six steps from green at 1 to red at
  13; the number is always there too, so the colour is never the only signal.
- **A card can carry a guessed build time** beside its points: how long Claude expects
  it to spend in Doing. It is written after the points, `· 3 pts · ~40 min`, in minutes
  under 2 hours and in hours to the half above (`~2.5 h`). `soloagile card add` and `set`
  take `--guess 40` or `--guess 1.5h`. A question has none. Every new work card gets
  one, made from the project's own past: the session start gives Claude a table, one line
  per size, with its usual time in Doing and the two finished cards closest to it as
  examples. `soloagile sizes` prints it again. Cards that went through Doing in under 3
  minutes are left out, as in the time-to-build report. Once a guessed card is built, its
  face says under the foot how close it came, `guessed 40 min, took 52 min`, and the
  time-to-build report says how many guessed cards took between half and double their
  guess, with up to four weeks of it and whether that is getting better.
- **Habits are switches for ways of working**, listed in `src/habits.js`. Each is on until
  switched off: for every project under `"habits"` in `~/.soloagile/settings.json`, or for one
  under `"habits"` in its `pm/settings.json`, which wins. The page's Settings tab shows each
  habit, on or off, where that comes from, and the command that flips it. It is read-only:
  the user tells Claude, or runs `soloagile set <habit> on|off [--all]`, which rebuilds the
  page. A habit whose card isn't built yet shows as coming. Built so far: start a card while
  something slow runs, what the user mentions becomes a card, about 15 cards per milestone
  (`card add` warns past it), questions in batches, a page of pictures per card,
  pictures from a kept script, the weekly clean-up with a day-end backup, and retro
  lessons as standing rules.
- **Standing rules**: in a retro, each change the user picks also becomes a numbered rule
  in a `## Standing rules` section of the project's `CLAUDE.md`, said as what to do and
  tagged with its retro and card: `soloagile rule "<the rule>" --from "retro of M3, #12"`.
  The command makes the section when missing, numbers on from the last rule, never adds the
  same rule twice, and writes nothing when the retro-rules habit is off.
- **`soloagile cleanup`** clears what can be made again: helper worktrees under
  `.claude/worktrees` whose branch is merged and clean, `soloagile shots` folders untouched
  for a week, and the picture pages of cards finished over a week ago (their script in
  `pm/takes/` stays). `--dry-run` only says; `--days` changes the week. With the
  weekly-cleanup habit on, a session start runs it once a week per project (stamps in
  `~/.soloagile/cleanups.json`). **`soloagile backup`** runs the command named `"backup"` in
  `pm/settings.json`, such as `"tools/backup.sh"`; the save skill runs it last.
- **A card can have its own page of pictures**, for the user's look. `soloagile pictures
  <card> [files…] [--url <address>]… [--caption "…"]… [--by "<command>"]` copies the files,
  and soloagile shots' four pictures of each address, into `pm/designs/card-<n>/` with an
  `index.html` showing each under its caption. A retake replaces them all. The page's address
  goes on the card as a `pictures:` line, once, and the card's pop-up has an "Open its picture
  page" button; the photo icon counts its pictures. The whole command is kept in
  `pm/takes/card-<n>.sh`, in git, and `soloagile retake <n>` runs it, running `--by` first. A
  page server serves `designs/card-<n>/` too: its index and its pictures and films. The session start tells Claude
  each built habit, on or off, so a change takes effect at the next session.
- **A card's face has a head and a foot.** The head holds the waiting pill (Decide,
  Design, Look), the milestone, the picture count, and the card's number at the right.
  Then the title, its one-line note, and its date. The foot holds the stage on the left
  and one size chip on the right, `5 pts | ~90 min`, so nothing wraps unpredictably.
- **Cards show their stage.** A bar of six blocks sits at the card's foot, filled up to
  the card's stage on the wheel, with the stage's name beside it. Decision cards and Done
  cards have none; a design waiting on the user shows Design.
- **A waiting card says how long it has waited**, after its date: "waiting 6 days", or
  "since today". It counts from the card's own date (`live`, `asked`, or a `from` day
  that has come), on the board and in the home page's waiting list. The build writes it,
  and the open page counts again, so a quiet project's page is still right days later.
  A waiting card with no date shows none.
- **Icons (Lucide, ISC) mark things on every tab:**
  - the tabs, lanes, card types, milestones and dates
  - milestone status, with a progress bar on Plan
  - release and decision headings, which get date and commit chips
  - each link, by kind: repo, artifact, local server, file or website
- **The Reports tab charts the whole project on one line.** Its first chart is the
  burn-up: story points over time, from the first card with points to the last rebuild.
  - Three lines: the total, the points built, and the points the user approved. The gap
    between built and approved is what waits on them.
  - Some boards leave the points off a Done line. A card finished from Doing or the user's
    look keeps the points it had; anywhere else, no points means none.
  - A card counts once it is planned: out of Ideas, with a milestone. Built means it reached
    Needs your look; approved means Done. A finished card still counts after `/soloagile:save`
    clears it from the board.
  - A marker shows where each finished milestone's last card was approved.
  - Its header names the milestones in progress; past three, it gives how many, and the
    names on hover.
  - **Flow**: a band per lane over time, counting cards: Waiting on you at the bottom, then
    Doing and Up next. A band that keeps widening is where work piles up. Done is left out
    of the bands, since it only grows and would dwarf them; the burn-up shows it, and the
    table keeps it.
  - **Time to build, by size**: a column per card size and a dot per card, set by the time
    the card spent in Doing (or as a design waiting on the user) before it first reached
    the user's look. Time parked in Up next or waiting on a question doesn't count.
    - A card that went through Doing in under 3 minutes was moved there after the work, so
      it is left out, and a line under the chart says how many were.
    - The scale spaces 1 min, 10 min, 1 h, 8 h and 1 day evenly, so short and long cards
      both show. A band covers the middle half of each size's times, and a bar marks its
      usual time.
    - A sentence under the title reads the chart: whether bigger cards take longer, with
      each size's usual time. A size needs 3 cards to count.
  - **Finished per week**: a bar for each of the last eight weeks, Monday to
    Sunday, with the points approved in it. The bars add up to the burn-up's approved line.
  - Built is blue and approved is green. That pair stays apart for colour-blind eyes;
    green beside the Look lane's pink does not.
  - The charts are drawn when the page is built, with no chart library and no script.
    The lines are an SVG that stretches to any width; every label is HTML placed by
    percent, so text is the same size on the phone. The numbers are also in a table
    under the chart, one row per day.
- **The header names the milestone in hand**, which is the one whose cards are moving,
  not the first one still open in the plan. Doing decides it; with nothing in Doing, the
  cards waiting on the user do, then Up next. The milestone with the most of those cards wins,
  and a tie goes to the later one. A finished milestone is never in hand. With no such
  card, it is the plan's first open milestone. The home page's rows and bars follow the
  same rule.
- **Each milestone has its own colour**, so they can be told apart at a glance. There are
  eight, taken in turn by the milestone's number, so M9 and M17 share one. A milestone's
  tag is tinted in its colour with a matching outline: on a card, in the header's strip and
  on the Plan tab. Its name takes the colour in "Working on", on the burn-up's markers and
  on the home page. Each colour has a dark and a light value.
- **One self-contained HTML file.** `soloagile build` renders the Markdown to HTML with a
  vendored copy of `marked` (MIT). Its only scripts are the theme toggle and one that
  counts the days on waiting cards, opens a picture full size and reloads the page when its file changes. It needs no server, and its tabs work
  with plain CSS.
- **An open page refreshes itself, with or without a server.** Opened as a file, it can't
  ask a server whether it changed, so each build leaves a stamp: a one-line script in
  `~/.soloagile/stamps` saying when the page was built. The open page loads it every three
  seconds and reloads when that time is not its own. Served over http, it asks the server
  for the file's ETag instead. Either way it waits while a card is open.
- **Generator is a Node script with zero npm dependencies.** It needs Node 22 or newer.
- **`soloagile help` lists every command, one to a line.** A command that doesn't exist
  gets the same list back, so a wrong guess is put right in one step.
- **The home page lists every project's page**, with its current
  milestone and its waiting count. Each row has a bar for the milestone in hand, in
  the burn-up's colours: points approved over points built, out of the total. A project
  with no card moved for seven days gets a Quiet pill and is dimmed. The flag is worked
  out when the home page is rebuilt, which happens whenever any project's page is.
  Above the rows is one list of every card waiting on the user, from every project,
  decisions first; each row links to its project's page.
- **Nothing is asked at install: where things are is worked out.**
  - A project's page opens as its own file, `<repo>/pm/index.html`.
  - The projects folder is the folder a project sits in. Its home page lists the projects
    in it, and is written to `~/.soloagile/home.html`.
- **A page server is optional, and set once.** Someone who serves the pages over http says
  so in `~/.soloagile/settings.json`. Every key is optional:
  - `pageUrl`: the server's address for a project's page, with `{project}` for its folder
    name, such as `http://192.168.0.10/{project}/`
  - `pageUrl2`: a second address for the same page, such as one that works away from home
  - `projectsFolder`: the folder the server serves. Only projects directly in it get
    those addresses and a row on the home page; any other project opens as a file
  - `homePage`: where the home page is written
  - `usageUrl`, `usagePath`, `usagePaths`, `usageStop`: where `soloagile usage` reads how
    much Claude usage is spent, for away mode. `usagePaths` names each window and its dotted
    path in that JSON, such as `{"week": "windows.seven_day.used_pct", "5 hours":
    "windows.five_hour.used_pct"}`, and is used instead of the single `usagePath`. Away mode
    stops after the card in hand once any of them reaches `usageStop` (98 unless set)
  A server should serve only each project's `pm/index.html` and the home page, and
  nothing else from the project folders. `extras/page-server/` is a sample that does:
  nginx in Docker, with its own short README.
- **A card stays in Doing until its work is live**, so every look is one the user can do
  straight away. Live means deployed, for a project on a server, or installed and
  running where the user uses it, for a local one. Built but not yet deployed is still
  Doing.
- **Done shows the last 48 hours.** A Done card stays for the day it finished and the
  two days after, so one finished on 30 Sep shows through 2 Oct. Then `soloagile archive`
  takes it off the board, and the page stops showing it even if that hasn't run. Writing a
  release note leaves Done alone: clearing Done at every release would empty it nearly
  every session.
- **A finished card is one line on the board.** When the user approves a card, `soloagile
  archive` moves its detail lines to `pm/finished-cards.md`, which holds every finished
  card in full, newest first. The page reads that file, so a Done card still opens in
  full. Sessions read the board many times a day, and on a busy project finished cards
  were most of it.
  - Nothing kept is lost: a card finished a second time keeps its old lines and gains
    the new ones.
  - `soloagile build` reports Done cards that still carry their text.
  - `soloagile board` prints the board with Done as one line, a count by milestone. The
    session skills read that. `soloagile finished M3` prints a milestone's finished cards
    in full, and `soloagile finished 12` one card.
- **Answered decisions go to `decisions.md`** with the date and the answer,
  rather than being deleted.
- **A project that uses OpenSpec:** one card per OpenSpec change; its `tasks.md`
  stays the detail.
- **`pm/` goes in `.dockerignore`** so a deployed website can never serve it.

## The files in each project

```
<repo>/pm/
  plan.md        goal, out of scope, milestones
  board.md       the kanban board
  releases.md    release notes, newest first
  overview.md    what it is, how to run it, how it's built (about 60 lines max)
  decisions.md   decisions the user made, newest first
  links.md       every address Claude creates: sites, IPs and ports, artifacts, repos
  history.md     every card move, with its time. Written by `soloagile build`; never edit by hand
  finished-cards.md   every finished card in full, newest first. Written by `soloagile archive`
  designs/       pictures for a waiting card's options, such as 12-a.png. Made by `soloagile design`; kept out of git
  index.html     GENERATED — never edit by hand
```

### board.md

The six columns, always in this order and always present, even when empty:
**Ideas → Up next → Doing → Needs your look → Needs your decision → Done**.

- **One line per card:** `- #id title · milestone · points · stage · date`. Indented lines
  underneath are its optional description. The first is the short line the card
  shows; the rest open when the user clicks the card.
- **Points are a quick estimate, written `3 pts`.** Claude picks one when it makes the
  card, from the title and what it already knows, without researching it first:
  - `1 pt`: a tweak, such as one line or one rule
  - `2 pts`: a small change in one place
  - `3 pts`: an ordinary card, with code, tests and docs
  - `5 pts`: several parts, or something unfamiliar
  - `8 pts`: most of a session
  - `13 pts`: too big, so split it into smaller cards

  They measure size, not hours. A decision card has none, because a question has no
  size. The estimate stays as first written unless the card's scope changes.
- **Only a Doing card has its stage written:** `design`, `develop`, `test` or `release`.
  Claude changes the word as the work moves on; with none, the card counts as `develop`.
  Every other lane implies its stage: Ideas and Up next are Plan, Needs your look is
  Feedback. `soloagile build` reports a stage written anywhere else, except on a design card.
- **IDs are never reused.** `<!-- next-id: N -->` holds the next free ID.
- **Claude changes the board with `soloagile card`**, not by editing the file. The command
  numbers a new card, writes its line, puts it in its lane and rebuilds the page. It is
  strict: a move that would leave the board wrong is refused with the reason and what to
  type instead, and nothing is written.
  - `soloagile card add "<title>" --milestone M3 --points 3 --done-when "…"` adds a card
    to Up next. `--lane ideas`, `doing` or `decision` picks another lane; `--note "…"`
    adds a detail line; a decision takes `--option "…"` for each option, and `--design`
    for a design card. It refuses a card with no milestone, a milestone `plan.md`
    doesn't have, no points (a question has none), a decision with fewer than two
    options, or a card to be built with no "done when".
  - `soloagile card move <number> <lane>`, where the lane is `ideas`, `next`, `doing`,
    `look`, `decision` or `done`. It writes the stage and the date the lane carries:
    `doing test` sets a stage, `look` dates the card `live <today>`, `look --from <date>`
    dates it for later, `decision` dates it `asked <today>`, and `done` dates it and moves
    its text to the archive. It refuses a look with no `tested:` line, a decision with no
    options, and a card with no milestone or no points. A card coming back from Done
    gets its text back.
  - `soloagile card note <number> "<line>"` adds a detail line, first with `--first`.
    `soloagile card set <number>` changes the milestone, points or title.
    `soloagile card show <number>` prints one card in full, finished or not.
  - `soloagile card choose <number> <letter>` records the user's pick on a question or
    design card. Its a/b/c lines become one line, where the first option was:
    `chosen <today>: c) words light the matching cards`. It refuses a letter the card
    doesn't have and a card with no options. It doesn't move the card; `card move` does.
    The picked option's picture stays under its `chosen` line, so a design card shows
    what was picked until the user's yes on its look.
  - `soloagile card reword <number> "<start>" "<new line>"` changes the one detail line that
    starts with those words, and `soloagile card unnote <number> "<start>"` removes it. Case
    doesn't matter. Both refuse when no line starts so, or more than one does.
  - `soloagile card drop <number> "<why>"` takes a card off the board without it being done,
    such as one folded into another. The reason goes at the top of `decisions.md` as
    `## <today> · #<n> dropped: <title>`, with `**Why:**` and the card's text. The burn-up
    takes its points out of the total.
  - Editing `board.md` by hand still works, for what the command can't do. `soloagile build`
    checks it afterwards, as before. In twelve days of use Claude changed boards about
    1,770 times with one-off scripts, and the checker sent 89 of them back.
- **Cards are created when their milestone starts.** Later milestones live only
  in `plan.md`, which keeps the board short.
- **Every card has a milestone, an idea too.** A new card joins the closest milestone in
  `plan.md`. When none fits, Claude adds a milestone for it, as `not started`.
  `soloagile build` reports a card with none.
- **One card per result the user would recognise**, such as "Links tab" or "Web
  server", not one per small step. That's roughly 3 to 8 cards per milestone.
  Small fixes fold into the card they belong to.
- **Write for a five-second read.** The user reads the card's face at a glance and
  clicks for the rest:
  - titles are plain English, eight words or fewer, with no file paths unless the path is the point
  - the first indented line is the short line: eight words or fewer, saying what
    matters most. The page cuts it off after two lines of the card
  - the lines after it are the full description, one fact per line. They show only
    in the card's modal, so they can run as long as the card needs: how to look
    at it, what was found, what is left
- **A decision card** puts the question in the title and one option per detail
  line, written `a) `, `b) ` and so on. The recommended option comes first and ends
  with `(recommended)`. The last option is an open one, such as `something else:
  tell Claude`, because the user always gets room for their own answer. The card's face
  shows how many options there are, and the modal lists them. A short line may come
  before the options.
- **A design card** is a work card whose approach waits for the user's yes, before any code.
  It sits in Needs your decision with `design` on its line, and keeps its points:
  `- #12 Stage strip · M1 · 5 pts · design · asked 2026-10-02`. Its detail lines are a
  short line saying what is being chosen, then the options, written as on a decision
  card. The page gives it a Design pill, where a question has Decide, and a bar at
  Design. The user's yes moves it back to Doing as `develop`, with the approach they chose as
  a detail line in place of the options, and the answer goes in `decisions.md`.
- **An option can have a real picture**, so the user chooses from what each would look like
  and not from a drawing made of text characters. Claude writes a small HTML mock-up of
  each option and runs `soloagile design <card number> <option letter> <mock-up.html>` in the
  project. That photographs the whole mock-up into `pm/designs/<card>-<letter>.png`, and
  the card's modal shows it under that option, on the desktop and the phone. The question
  in the terminal gives the page's link, and the user still answers there.
  - A mock-up is drawn 360 wide, a small phone, which fits the modal without shrinking. A
    fourth argument sets another width, up to 1400, for a layout that needs the room.
  - It shows the part being chosen, not a whole page, and is taken in the dark theme.
  - The page links the picture as `designs/<card>-<letter>.png`, beside it, rather than
    holding it, so a page with many pictures stays small. That works for a page opened as
    a file; a page server serves `pm/designs/` too.
  - The card's face shows a photo icon in its top row, with how many pictures are inside,
    so the user knows to open it. A card with none shows nothing.
  - A click on a picture opens it full size in a new tab.
  - It works on any card in Needs your decision, a design or a plain question.
  - The pictures stay out of git and are left in place once the user has chosen. Card
    numbers are never reused, so an old picture is never shown again.
- **The date means something different in each column:**
  - Done: the date it finished
  - Needs your look: `live <date>`, or `from <date>` when the user can't do the look before
    that day (a real event, a delivery). Until the day comes, the card is marked Later,
    sits last in Waiting on you, and isn't counted as waiting anywhere.
  - Needs your decision: `asked <date>`

```markdown
# Board
<!-- next-id: 15 -->

## Ideas
- #14 Dark-mode toggle on the phone view · M2 · 2 pts

## Up next
- #9 Parse board.md into columns · M1 · 3 pts · ~40 min
  six columns, always in order
  done when: node --test passes for all six columns

## Doing
- #8 Write the page template · M1 · 5 pts · ~90 min · test

## Needs your look
- #7 Light/dark page on desktop · M1 · 3 pts · live 2026-10-01

## Needs your decision
- #11 Show dates on cards? · M1 · asked 2026-10-01
  a) Only in Done (recommended)
  b) On every card
  c) Something else: tell Claude

## Done
- #6 Folder convention agreed · M0 · 1 pt · 2026-09-30
```

### plan.md

The `# Heading` is the project's name as the page shows it. A milestone's status
is one of: `not started`, `in progress`, `done YYYY-MM-DD`. The `short:` line under a
milestone's heading is 2 to 4 words saying what it is: its chips on the page show them,
after its number. The Plan tab hides the line, since it shows the full title. A
milestone with cards names each by number on a `Cards:` line under its `short:` line, and
Claude adds a card's number when it joins the milestone.

```markdown
# My Project
## Goal
One paragraph: what this project is for and what "finished" looks like.
## Out of scope
- Things we've agreed not to build.
## Milestones
### M0 — Convention · done 2026-09-30
short: The format
Done when: the user agrees the format reads right.
### M1 — The page · in progress
short: First page
Cards: #6, #7, #8
Done when: tests pass and the user has seen it in light and dark.
```

### releases.md

Each entry has at most three "What's new" bullets, written in plain English for the user.
`**Cards:**` lists only the cards whose work shipped in that release, never older
work that happened to be approved at the same time.


```markdown
## 2026-10-03 · M1 finished · a1b2c3d
**What's new**
- Every project now has a page: board, plan, releases, docs.
**Cards:** #6, #7, #8, #9
```

### links.md

Group the links under any `##` headings that suit the project, such as Live,
Local, Artifacts, Code or References. One link per line: `- [label](url) · note · added <date>`.
A link that stops working gets `· retired <date>` rather than being deleted.
A `file://` address is never listed: a file's path differs on every machine.

```markdown
## Live
- [The site](https://myproject.example.com) · production · added 2026-08-07
## Local
- [Dev server](http://localhost:5173) · `npm run dev` · added 2026-09-30
## Artifacts
- [Releases page](https://claude.ai/code/artifact/…) · added 2026-08-10
```

### decisions.md

```markdown
## 2026-09-30 · Where should the page live?
**Answer:** a file in each repo. **Why:** no server needed on the desktop.
```

### history.md

The record the reports read. The board keeps no history, and Done cards leave it after
48 hours, so `soloagile build` adds a line here each time a card changes lane, stage, points,
milestone or title. Each line is the time, the lane, then the card as `board.md` writes
it. A card that leaves the board gets the lane `gone`. It is a log, and not read from git,
because git is only as exact as the commits.

```markdown
- 2026-10-02 09:14 · Up next · #69 A record of every card move · M8 · 5 pts
- 2026-10-02 13:02 · Doing · #69 A record of every card move · M8 · 5 pts · develop
- 2026-10-02 14:20 · Doing · #69 A record of every card move · M8 · 5 pts · test
- 2026-10-05 09:00 · gone · #30 The board, from the old task list · M4
```

- **The times are to the minute**, because the rebuild hook runs on every edit.
- **The first build fills in earlier days from git**, one step per commit that changed
  `board.md`. Those days are only as exact as the commits: a card built and finished
  between two commits shows no time in Doing.
- **It is committed with the board.** The session-end hook, when on, saves it like any `pm/*.md`.
- **A card moved with two edits shows as one move.** It is off the board for a moment
  between them; a `gone` less than ten minutes old is dropped when the card comes back.

## The wheel: how every card is built

The guiding star for every project: **Plan → Design → Develop →
Test → Release → Feedback**, and round again. Every card goes through all six. The lanes
stay as they are; the stage says how far round a card is.

| Stage | Claude | The user | Lane |
|---|---|---|---|
| **Plan** | Writes the card: a title, points, a milestone (an idea too) and a "done when" line. When a plan leans on a fact from docs, tries it for real first. When a milestone can only be proven in a special set-up, such as a clean machine, makes setting that up its first card. | Says what they want, and picks what's next. | Ideas, Up next |
| **Design** | Settles the approach before any code. 1 or 2 points: says it in one line and carries on. 3 points or more: moves the card to Needs your decision as a design card and asks the user. For anything visual, each option gets a real picture on the card, made with `soloagile design`. | For 3 points or more: says yes, or what to change. | Doing. Needs your decision while a design waits for the user's yes |
| **Develop** | Builds it. If the build departs from the option the user picked, says so at once, not at their look. | Nothing. | Doing |
| **Test** | Runs the project's checks. For anything seen in a browser, then runs `soloagile shots <url>` and reads its four screenshots: desktop and phone width (360px), dark and light. To open a pop-up or fill in a box first, adds `--click` and `--type`. Uses a real browser only for what that can't do, such as dragging. Fixes what turns up, and writes a `tested:` line on the card. | Nothing: a card reaches them already tested. | Doing |
| **Release** | Commits the card's work, without waiting to be asked, before the card moves to Needs your look. Deploys where the project has a server, and writes the release note. | Says "deploy" or "ship it" for a server. "commit" still works at any time. | Doing, until it's live |
| **Feedback** | Asks for the user's look on the card. When the milestone's last card is approved, runs `/soloagile:retro`: open questions, what worked, what to change, what's next. | Looks, and says yes or what to fix. Answers the retro. | Needs your look, then Done |

- **Feedback feeds Plan.** A retro's answers become Ideas cards and the next milestone,
  which is where the wheel starts again.
- **A stage is never skipped, only made small.** A 1-point card's design is one line and
  its test may be one command, but both still happen.
- **"Done when" is written at Plan** and checked at Test, so a card's finish line is set
  before the work starts.
- **`soloagile shots <url> [dir]` takes the screenshots with nobody watching.** It writes
  `desktop-dark.png`, `desktop-light.png`, `phone-dark.png` and `phone-light.png`, and
  prints their paths for Claude to read. Desktop is 1400 by 900; phone is 360 by 780,
  a small phone. It sets each theme both ways a page might follow it: the system's
  light or dark setting, and the choice a pm page stores. It drives a headless
  browser: the one `SOLOAGILE_BROWSER` names, then the Chromium that Playwright leaves in
  its cache, then a Chrome, Chromium, Edge or Brave already on the machine, on Linux or a
  Mac. Nothing else depends on it: with no browser, only `shots` and `design` are lost.
  The browser starts with its sandbox on. One that can't, such as Playwright's on Ubuntu,
  goes without it only for a page on this machine or its network, never one from the internet.
- **`soloagile shots <url> --full` takes the whole page.** Each of the four pictures is the
  page's full height instead of only the top, up to 16000px. A taller page is cut off
  there, and shots says so. Use it to check colours or layout lower down a page.
- **`soloagile shots` can click and type before the picture.** `--click "<words>"` clicks what
  says that, and `--type "<box>=<text>"` fills in a box or picks from a list. Any number
  of each run in the order written, on every one of the four pictures:
  `soloagile shots <url> --click "Filters" --type "Search=kitchen"`.
  - A click is named by the words on it, and a box by its label or its greyed-out hint.
    A CSS selector works for either when nothing has the words.
  - The click is a real mouse click and the text is really typed, so a button that is
    covered up fails instead of passing. A name that matches nothing fails too, and lists
    what the page does offer.
  - The page is scrolled to what was clicked, so a chart low on a page can be reached.
  - A real browser is only for what this can't do, such as dragging.
- **New charts and new skills get one more check.** A new chart is checked on a project
  with many milestones, such as 3dweather, as well as the project it was built in. A new
  skill's card reaches Needs your look only after the skill has run once for real, with
  its `tested:` line saying what it did.
- **The commit comes before the look.** A card's work is committed before the card moves
  to Needs your look, so the page and the repo never disagree about what is built.
- **A card reaches Needs your look with a `tested:` detail line** saying what was
  checked, such as `tested: 89 checks pass; seen at desktop and 360px, dark and light`.
  `soloagile build` reports a look that has none, and the rebuild hook shows that to Claude, so
  a card can't reach the user untested by mistake. Looks that went live before the check
  began, on 2026-10-03, are left alone.

- **`/soloagile:retro` closes a milestone.** Claude drafts a few points under each part from the
  milestone's cards, decisions and commits, and the user picks, with room for their own. Open
  questions are asked first, one by one. The retro is saved in `decisions.md`; each
  change they pick becomes an Ideas card; their "what's next" picks become the next
  milestone in `plan.md`, as `not started`. Then the milestone is set to done and its
  release note written.
- **Time passing doesn't hold a card open.** A "done when" that needs days to pass, or a
  look that waits on an outside event, is approved on what was built. The rest becomes a
  follow-up card with a `not before <date>` line.

## How it stays up to date

| When | What happens |
|---|---|
| Claude starts a task | Its card moves to **Doing**: `soloagile card move <number> doing` |
| A Doing card reaches its next stage | Claude changes the stage on its line: `design`, `develop`, `test`, `release` |
| A card's work is built | Claude runs the checks and `soloagile shots`, and writes the card's `tested:` line |
| Live, needs the user to see it | Claude commits the work, then the card moves to **Needs your look**. Built but not yet live stays in **Doing** |
| Claude starts a card of 3 points or more | It goes to **Needs your decision** as a design card, with a picture on each option for anything visual. The user's yes moves it to **Doing** as `develop` |
| Claude needs a decision | Card goes in **Needs your decision** (this replaces QUESTIONS.md) |
| Claude needs the user to pick a name | It checks each name is unused where a clash would matter, and offers plain names that say what the thing is |
| The user approves or answers | Card moves to **Done**; the answer goes to `decisions.md`. `soloagile archive` then moves the card's text to `finished-cards.md` |
| A deploy | The cards whose work went live move to **Needs your look**, and a release note lists them |
| A milestone's last card is approved | `/soloagile:retro`: the user picks what worked, what to change and what's next. Then the milestone is set to done and its release note is written, listing the cards whose work shipped in it |
| Claude creates anything with an address (site, port, artifact, doc, repo) | It goes in `links.md` straight away |
| Any `pm/*.md` file is edited | A hook rebuilds `pm/index.html`. Open pages refresh themselves within a few seconds, once any open card is closed |
| A card changes lane, stage, points, milestone or title | The same rebuild adds a line to `history.md`, with the time |
| `/soloagile:catchup` | Reads the board without its finished cards: the two "Needs your…" columns first, then Up next |
| `/soloagile:save` | Tidies the board against the git log, runs `soloagile archive`, which also takes Done cards past their 48 hours off the board, and keeps NEXT_SESSION.md short |
| Starting a new project | `/soloagile:init` runs automatically and creates `pm/` from starter files |
| An existing project gets its page | `/soloagile:init` builds the board, plan and release notes from its handoff files, then shrinks those files |
| The user says "what needs me" | `/soloagile:needs` asks about every waiting card as multiple choice, moves the cards and logs the answers |
| A session opens, or after `/clear` or a compaction | A hook shows what waits on the user, and gives Claude the short rules (`rules.md`) and the board |
| The user says "catch me up", "commit", "done for today", or "retro" | Claude runs `/soloagile:catchup`, `/soloagile:commit`, `/soloagile:save`, or `/soloagile:retro` |
| The user says "deploy" or "ship it" | Claude deploys the way the project's own docs say |
| A session ends, or `/clear` | If the user turned that option on at install: a hook commits and pushes any changed `pm/*.md`, NEXT_SESSION.md or QUESTIONS.md, and nothing else |

The whole flow, for the user, is the home page's Session flow tab (`template/flow.md`).

## What is in this repo

```
soloagile/
  .claude-plugin/         plugin.json and marketplace.json: what makes this repo a plugin and its own store
  bin/soloagile           `soloagile build [repo]`, `init`, `home`, `card`, `archive`, `board`, `finished`, `set`, `pictures`, `retake`, `cleanup`, `backup`, `rule`, `usage`, `sizes`, `link`, `shots <url>`, `design` and the hooks. On Claude's PATH while the plugin is on
  hooks/hooks.json        the three hooks: rebuild after an edit, session start, session end
  rules.md                the short rules the session-start hook gives Claude in a project with pm/
  skills/                 the eight skills: init, catchup, commit, needs, retro, save, away and parallel, typed `/soloagile:<name>`
  src/habits.js           habits: switches for ways of working, the Settings tab, soloagile set (tested)
  src/pictures.js         soloagile pictures and retake: a card's page of pictures, and its kept script (tested)
  src/cleanup.js          soloagile cleanup and backup, and the weekly run at session start (tested)
  src/rules.js            soloagile rule: a numbered standing rule in the project's CLAUDE.md (tested)
  src/usage.js            soloagile usage: the week's and the 5 hours' usage from a usage address, for away mode (tested)
  src/sizes.js            soloagile sizes: each size's usual build time from pm/history.md, with examples; the session start gives it to Claude (tested)
  src/settings.js         where things are: worked out, or read from ~/.soloagile/settings.json (tested)
  src/session.js          the session hooks: start summary, handoff commit at the end
  src/board.js            reads board.md into columns (tested)
  src/card.js             soloagile card: add, move, note, choose, reword, unnote, drop, set and show, each checked before it is written (tested)
  src/archive.js          finished-cards.md: finished cards' text, kept off the board (tested)
  src/history.js          writes history.md: every card move, with its time (tested)
  src/reports.js          the Reports tab: charts worked out from history.md (tested)
  src/hook.js             the rebuild hook
  src/shots.js            soloagile shots: four screenshots with nobody watching, after any clicks and typing (tested)
  src/design.js           soloagile design: a picture of a mock-up, under an option on a waiting card (tested)
  src/home.js             the home page: the waiting list and the projects
  src/init.js             soloagile init
  template/page.html      the page: six tabs, light/dark, phone-width
  template/home.html      the home page: the waiting list, one row per project, and the Session flow tab
  template/flow.md        the Session flow tab's text
  template/head.html      shared styles and theme toggle; refresh.html is the live refresh
  template/guide.html     the "?" button and the command guide it opens, on both pages
  vendor/marked.esm.js    Markdown renderer (MIT)
  starter/pm/*.md         starter files for new projects
  extras/page-server/     optional: a sample page server, for reading the pages from another device
  test/                   node --test
```

## Risks

- **Two sources of truth creeping back.** NEXT_SESSION.md could grow a task list
  again. Rule: tasks live only in `board.md`.
- **The board drifting from reality** if a card move is forgotten mid-session.
  `/soloagile:save` checks the board against the git log.
- **A website serving `pm/`.** Some sites deploy straight from the repo root.
  Guard with `.dockerignore`, and check before a first deploy.
