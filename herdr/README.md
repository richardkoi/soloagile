# soloagile for Herdr

Three add-ons (Herdr calls them mods) for people who run Claude Code inside
[Herdr](https://herdr.dev) and keep their projects on soloagile boards.

- **soloagile-board**: F3 opens the board of the project in the focused terminal: the
  next move, the cards waiting on you (with a button that types `/soloagile:needs` into
  that space's Claude), Doing, the top of Up next, the milestones being worked on, and a
  button that opens the project's page. A card shows its first picture; click a card for
  its full text, all its pictures and its links. Click a picture to see it full screen,
  and again to put it back.
- **soloagile-picture**: the full-screen picture, opened by soloagile-board.
- **soloagile-alerts**: a 1px strip at the bottom of the layout. When a card lands in
  Needs your look or Needs your decision on any open project's board, a pop-up names it
  and a sound plays, with a desktop notification while Herdr isn't the window in use.
  It shares the count waiting in each space as `shared("soloagile.waiting")`
  (`{ [space id]: count }`) for a tab bar to show.

The board and the alerts read `soloagile board --json` (soloagile 1.18.0 or later), never the Markdown, so a
change to the board's format can't break them. They find the newest installed soloagile
by themselves.

## Install

With soloagile 1.19.0 or later:

```sh
soloagile herdr
```

It copies the three mods into `~/.config/herdr-app/mods`, and binds F3 to
`mod.open:soloagile-board` in `~/.config/herdr-app/keys.json` unless F3 is already taken.
Run it again to update them: it writes only what changed, and keeps the sound the alerts
already use. `soloagile herdr --sound <name or file>` changes that sound (a Herdr sound
name such as `blocked`, or a file, which is copied into `~/.config/herdr-app/sounds`), and
`--dry-run` says what it would change. Once installed, they are updated by themselves at
the first session start after a soloagile update.

The alerts strip docks into the layout shown when Herdr first sees its folder.

## What they run

They run programs: `soloagile board --json`, `git rev-parse --show-toplevel` (to find
each terminal's project), `xdg-open` (the page button), `notify-send` (desktop
notifications) and `hc send` (the needs button). They read nothing outside the project
and reach no network.
