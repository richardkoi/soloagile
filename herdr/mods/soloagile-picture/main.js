// soloagile-picture: one card picture, as big as the screen allows. soloagile-board opens
// it as a dialog when a picture in a card is clicked; a click on it, a click beside it, or
// Esc closes it, back to the card.
// props: { shown: the picture's path inside Herdr's folder, width, height: its pixels }.
import { View, div, image } from "gpui-kit";
import { v_flex } from "gpui-base";
import { props, closeOverlay, settings, theme } from "herdr";

export default class SoloagilePicture extends View {
  init(_props, _cx) {
    this.size = null; // the room the dialog has, in layout pixels
  }

  render(_cx) {
    const t = theme();
    const p = props();
    const close = (_e, cx) => { cx.stop_propagation(); closeOverlay(p.overlay); };
    // Fit the picture in the room, keeping its shape, never bigger than its own pixels.
    let w = 0, h = 0;
    if (this.size) {
      const ratio = p.width && p.height ? p.height / p.width : 0.6;
      w = Math.min(this.size.width, this.size.height / ratio, p.width || Infinity);
      h = w * ratio;
    }
    return v_flex().id("sp-root").size_full().items_center().justify_center()
      // The size comes in screen pixels; the layout is in pixels before Herdr's zoom.
      .on_size_change((size, cx) => {
        const zoom = settings()?.zoom || 1;
        const next = { width: size.width / zoom, height: size.height / zoom };
        if (!this.size || Math.abs(next.width - this.size.width) > 1 || Math.abs(next.height - this.size.height) > 1) { this.size = next; cx.notify(); }
      })
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(close)
      .when(w > 0, (el) => el.child(image(p.shown).w(Math.round(w)).h(Math.round(h)).rounded(6).border_1().border_color(t.border)));
  }
}
