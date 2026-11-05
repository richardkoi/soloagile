// soloagile-alerts: runs in the background, as a 1px block at the bottom of the layout.
// When a card lands in "Needs your look" or "Needs your decision" on the board of a project
// open in any space, a pop-up names it and a sound plays; while Herdr isn't the window in
// use, the desktop gets a notification too. Clicking the pop-up shows that space. Each card
// alerts once; a card that leaves and comes back alerts again.
// It also shares how many cards wait in each space, as shared("soloagile.waiting"):
// { [space id]: count }, for a tab bar to show. All of it comes from
// `soloagile board --json`, so a change to soloagile's Markdown never breaks it.
import { View, div } from "gpui-kit";
import { spaces, panes, exec, notify, playSound, shared, setShared, theme, window } from "herdr";

const EVERY = 15000;     // how often the boards are read, in ms
const SOUND = "blocked"; // Herdr's sound for "waiting on you"; or a file under ~/.config/herdr-app

// The soloagile command: see soloagile-board/main.js.
const FIND = `command -v soloagile || ls -d "$HOME"/.claude/plugins/cache/soloagile/soloagile/*/bin/soloagile 2>/dev/null | sort -V | tail -1`;

// A desktop notification, only while Herdr isn't the window in use (Herdr shows its own pop-up then).
function desktop(title, body) {
  if (window()?.active) return;
  exec("notify-send", ["-a", "Herdr", title, body]).catch(() => {});
}

export default class SoloagileAlerts extends View {
  init(_props, cx) {
    this.root = {}; // cwd -> repo folder (or the cwd when not in a repo)
    // Cards already announced, per project folder. A project seen for the first time is
    // only remembered, not announced, so a restart doesn't replay old cards.
    try { this.announced = JSON.parse(localStorage.getItem("announced") || "{}"); } catch { this.announced = {}; }
    cx.timer.every(EVERY, (cx) => this.check(cx));
    this.check(cx);
  }

  check(cx) {
    if (this.checking) return;
    this.checking = true;
    cx.spawn(async (cx) => {
      try {
        if (this.bin === undefined) {
          const r = await exec("sh", ["-c", FIND]).catch(() => null);
          this.bin = (r && r.stdout.trim().split("\n").pop()) || null;
        }
        if (!this.bin) return;
        const all = panes();
        const read = {};    // project folder -> its waiting cards, read once per round
        const waiting = {}; // space id -> count
        let fresh = 0;
        for (const space of spaces()) {
          if (space.machine) continue; // this computer only
          const ids = new Set(space.tabs.map((t) => t.id));
          const first = all.find((p) => ids.has(p.tab) && p.terminal && p.cwd);
          const cwd = (first && first.cwd) || space.folder;
          if (!cwd) continue;
          const root = await this.repoFolder(cwd);
          if (!(root in read)) {
            read[root] = await this.waitingCards(root);
            const cards = read[root];
            if (cards) {
              const known = this.announced[root];
              const name = root.split("/").pop();
              for (const c of known ? cards.filter((c) => !known.includes(c.id)) : []) {
                desktop(`${name} needs you`, `#${c.id} ${c.title}`);
                notify({ title: `${name} needs you`, body: `#${c.id} ${c.title}`, level: "warning",
                         action: { name: "space.select", args: { id: space.id } } });
                fresh++;
              }
              this.announced[root] = cards.map((c) => c.id);
            }
          }
          if (read[root]) waiting[space.id] = read[root].length;
        }
        if (fresh) playSound(SOUND);
        try { localStorage.setItem("announced", JSON.stringify(this.announced)); } catch {}
        if (JSON.stringify(waiting) !== JSON.stringify(shared("soloagile.waiting") ?? {})) setShared("soloagile.waiting", waiting);
      } finally {
        this.checking = false;
      }
    });
  }

  // The decisions and looks waiting on the user now, or null for a project with no board.
  async waitingCards(root) {
    const r = await exec(this.bin, ["board", "--json", root]).catch(() => null);
    if (!r || r.code !== 0) return null;
    try {
      const j = JSON.parse(r.stdout);
      const lane = (n) => j.lanes.find((l) => l.name === n)?.cards ?? [];
      return [...lane("Needs your decision"), ...lane("Needs your look").filter((c) => !c.later)];
    } catch {
      return null;
    }
  }

  async repoFolder(cwd) {
    if (!(cwd in this.root)) {
      let root = cwd;
      try {
        const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
        if (r.code === 0 && r.stdout.trim()) root = r.stdout.trim();
      } catch {}
      this.root[cwd] = root;
    }
    return this.root[cwd];
  }

  // Nothing to show: a 1px strip in the canvas colour.
  render(_cx) {
    return div().size_full().bg(theme().canvas);
  }
}
