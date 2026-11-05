// soloagile-board: the soloagile board of the project you're looking at, in a Herdr window.
// F3 opens and closes it (keys.json: "f3": "mod.open:soloagile-board").
// Shows the next move, what waits on you, Doing, Up next and the milestones being worked
// on. Click a card for its full text. All of it comes from `soloagile board --json`, so a
// change to soloagile's Markdown never breaks this panel.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { focused, spaces, agents, exec, run, watchFolder, theme, props, closeOverlay } from "herdr";

const UP_NEXT = 5; // Up next cards shown; the rest are on the page.

// The soloagile command. Claude Code puts it on the PATH only inside its own sessions, so
// look for the newest installed copy of the plugin too. An old copy hands the command on
// to a newer one by itself.
const FIND = `command -v soloagile || ls -d "$HOME"/.claude/plugins/cache/soloagile/soloagile/*/bin/soloagile 2>/dev/null | sort -V | tail -1`;

const lane = (j, name) => j.lanes.find((l) => l.name === name)?.cards ?? [];

export default class SoloagileBoard extends View {
  init(_props, cx) {
    this.root = null;  // the project folder shown
    this.space = null; // the space it was found from
    this.data = null;  // the board's JSON, or { none: "why" }
    this.open = {};    // card id -> expanded
    this.cwd = undefined;
    this.follow(cx);
    // Spaces change without the files changing: check which project is shown.
    cx.timer.every(1000, (cx) => this.follow(cx));
    // Linux skips git-ignored folders when watching, and some projects git-ignore pm/,
    // so read the board again every 10 s as well as on a change.
    cx.timer.every(10000, (cx) => this.load(cx));
  }

  // Works out the shown project from the focused terminal's folder.
  follow(cx) {
    const f = focused();
    const space = f && spaces().find((s) => s.id === f.space);
    const cwd = (f && f.cwd) || (space && space.folder) || null;
    if (cwd === this.cwd) return;
    this.cwd = cwd;
    this.space = space || null;
    cx.spawn(async (cx) => {
      let root = cwd;
      if (cwd) {
        try {
          const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on: this.machine() });
          if (r.code === 0 && r.stdout.trim()) root = r.stdout.trim();
        } catch {}
      }
      if (root === this.root) return;
      this.root = root;
      this.data = null;
      cx.notify();
      this.load(cx);
      this.watch(cx);
    });
  }

  machine() {
    return this.space ? this.space.machine : null;
  }

  // Reloads whenever something in the project's pm/ folder changes (this computer only).
  watch(cx) {
    const dir = this.root && `${this.root}/pm`;
    if (!dir || this.machine() || this.watching === dir) return;
    this.watching = dir;
    cx.spawn(async (cx) => {
      while (this.watching === dir) {
        try { await watchFolder(dir); } catch { return; }
        if (this.watching !== dir) return;
        this.load(cx);
      }
    });
  }

  load(cx) {
    const root = this.root;
    if (!root || this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const on = this.machine();
        if (this.bin === undefined || on !== this.binOn) {
          const r = await exec("sh", ["-c", FIND], { on }).catch(() => null);
          this.bin = (r && r.stdout.trim().split("\n").pop()) || null;
          this.binOn = on;
        }
        let data;
        if (!this.bin) data = { none: "soloagile isn't installed on this machine." };
        else {
          const r = await exec(this.bin, ["board", "--json", root], { on }).catch((e) => ({ code: 1, stderr: String(e) }));
          if (r.code !== 0) data = { none: /no pm\/board\.md/.test(r.stderr) ? "No board in this project." : `soloagile: ${r.stderr.trim()}` };
          else {
            try { data = JSON.parse(r.stdout); } catch { data = { none: "soloagile gave something unreadable." }; }
            if (data.lanes === undefined) data = { none: "This soloagile is too old for the panel: update it to 1.18.0 or later." };
          }
        }
        if (root === this.root) { this.data = data; cx.notify(); }
      } finally {
        this.loading = false;
      }
    });
  }

  // "What needs me": types /soloagile:needs into Claude in this space, or starts Claude
  // with it in a new tab when none is running there.
  needs() {
    const space = this.space;
    const claude = space && agents().find((a) => a.space === space.id && /claude/i.test(a.app || a.title || ""));
    if (claude) {
      exec("hc", ["send", claude.address, "/soloagile:needs"]).catch(() => {});
      run("pane.focus", { terminal: claude.address });
    } else {
      run("tab.new", { ...(space ? { space: space.id } : {}), folder: this.root, argv: ["claude", "/soloagile:needs"] });
    }
  }

  render(cx) {
    const t = theme();
    const d = this.data;
    const name = d && !d.none ? d.project : this.root ? this.root.split("/").pop() : "";
    const stop = (_e, cx) => cx.stop_propagation();
    const header = h_flex().items_center().gap(8).px(14).py(10).border_b(1).border_color(t.border)
      .child(div().font_semibold().text_size(14).text_color(t.foreground).child("Board"))
      .child(div().text_size(13).text_color(t.muted).truncate().flex_1().child(name))
      .child(div().id("sb-close").px(6).text_color(t.dim).hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click(() => closeOverlay(props().overlay)).child("✕"));

    let body;
    if (!this.root) body = div().text_color(t.dim).child("Click into a terminal to show its project's board.");
    else if (!d) body = div().text_color(t.dim).child("Reading the board…");
    else if (d.none) body = div().text_color(t.dim).whitespace_normal().child(d.none);
    else {
      const needs = [
        ...lane(d, "Needs your decision").map((c) => ({ ...c, kind: "decision" })),
        ...lane(d, "Needs your look").filter((c) => !c.later).map((c) => ({ ...c, kind: "look" })),
      ];
      const next = lane(d, "Up next");
      // Bars only for milestones being worked on: a card waiting, in Doing or in Up next.
      const active = new Set([...needs, ...lane(d, "Doing"), ...next].map((c) => c.milestone));
      body = v_flex().gap(14)
        .child(this.nextMove(t, d))
        .child(this.section(t, "Needs you", t.blocked, needs, "Nothing waiting on you.")
          .when(needs.length > 0, (el) => el.child(this.button(t, "sb-needs", "Answer them (/soloagile:needs)", () => this.needs()))))
        .child(this.section(t, "Doing", t.working, lane(d, "Doing"), "Nothing in Doing."))
        .child(this.section(t, "Up next", t.idle, next.slice(0, UP_NEXT), "Nothing in Up next.", next.length))
        .when(d.milestones.some((m) => active.has(m.id)), (el) => el.child(this.milestoneList(t, d.milestones.filter((m) => active.has(m.id)))));
    }

    const footer = d && !d.none && d.page
      ? h_flex().px(14).py(10).border_t(1).border_color(t.border)
          .child(this.button(t, "sb-page", "Open the project's page", () => exec("xdg-open", [d.page]).catch(() => {})))
      : null;

    return v_flex().id("sb-root").size_full().bg(t.surface).text_size(13)
      .child(header)
      .child(v_flex().id("sb-scroll").flex_1().overflow_y_scrollbar().p(14).child(body))
      .when(Boolean(footer), (el) => el.child(footer));
  }

  nextMove(t, d) {
    return v_flex().gap(3).p(10).rounded(6).border_1().border_color(t.accent).bg(t.background)
      .child(div().text_size(11).font_semibold().text_color(t.dim).child("NEXT MOVE"))
      .child(div().text_color(t.foreground).whitespace_normal().child(d.next));
  }

  button(t, id, label, act) {
    return div().id(id).px(10).py(6).rounded(6).bg(t.raised).border_1().border_color(t.border)
      .text_size(12).text_color(t.foreground).hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => act()).child(label);
  }

  section(t, title, color, cards, empty, total = cards.length) {
    return v_flex().gap(6)
      .child(h_flex().items_center().gap(6)
        .child(div().w(8).h(8).rounded(4).bg(color))
        .child(div().text_size(11).font_semibold().text_color(t.dim).child(title.toUpperCase()))
        .child(div().flex_1())
        .child(div().text_size(12).text_color(t.dim).child(total > cards.length ? `${cards.length} of ${total}` : String(total))))
      .when(cards.length === 0, (el) => el.child(div().text_color(t.dim).child(empty)))
      .children(cards.map((c) => this.card(t, c, color)));
  }

  card(t, c, color) {
    const open = !!this.open[c.id];
    const tags = [
      c.kind,
      `#${c.id}`,
      c.milestone,
      c.points ? `${c.points} pt${c.points === 1 ? "" : "s"}` : null,
      c.kind ? null : c.stage === "plan" ? null : c.stage,
    ].filter(Boolean).join(" · ");
    return h_flex().id(`sb-card-${c.id}`).items_start().gap(8).p(8).rounded(6).bg(t.background)
      .border_1().border_color(t.border)
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { this.open[c.id] = !open; cx.notify(); })
      .child(div().w(3).h(30).rounded(2).bg(color))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().text_color(t.foreground).whitespace_normal().child(c.title))
        .child(div().text_size(11).text_color(t.dim).child(tags))
        .when(Boolean(c.waits), (el) => el.child(div().text_size(11).text_color(t.muted).whitespace_normal().child(`waits: ${c.waits}`)))
        .when(open, (el) => el.child(v_flex().gap(3).pt(4)
          .children(c.details.length
            ? c.details.map((n) => div().text_size(12).text_color(t.muted).whitespace_normal().child(n))
            : [div().text_size(12).text_color(t.dim).child("No notes on this card.")]))));
  }

  milestoneList(t, list) {
    return v_flex().gap(8).pt(10).border_t(1).border_color(t.border)
      .child(div().text_size(11).font_semibold().text_color(t.dim).child("MILESTONES IN PROGRESS"))
      .children(list.map((m) => v_flex().gap(4)
        .child(h_flex().gap(8)
          .child(div().flex_1().text_color(t.foreground).truncate().child(`${m.id} ${m.short || m.title || ""}`))
          .child(div().text_size(12).text_color(t.dim).child(`${m.done}/${m.total}`)))
        .child(div().h(6).w_full().rounded(3).bg(t.raised)
          .child(div().h_full().rounded(3).bg(t.done)
            .w(m.total > 0 && m.done > 0 ? `${Math.round((m.done / m.total) * 100)}%` : 0)))));
  }
}
