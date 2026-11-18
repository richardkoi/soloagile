# Page review against Chrome's Modern Web Guidance

Checked on 2026-11-18. **What was checked:** the page every project gets: `template/head.html`, `page.html`, `refresh.html`, `guide.html`, `awake.html`, `home.html`, and the markup `src/page.js` and `src/reports.js` write. **Against:** the guides dark-mode, dark-mode-toggle, light-dismiss-a-dialog, animate-to-from-top-layer, declarative-dialog-popover-control, tabs, accessibility, motion, responsive-design, defer-rendering-heavy-content, card, state-aware-sticky-headers and content-first-noise-reduction (fetched with `npx modern-web-guidance retrieve`). **How:** by reading the code, plus desktop (1400×900) and 360px phone pictures, dark and light, of soloagile's and weatherglider's boards. Nothing was changed.

Browser target: the guides were written for "Baseline Widely available". The page already goes past that, since popover is only "Newly available". Because the page only has to work in Chrome and Brave, some fixes below use Chrome-only features, and each one says so.

## Findings, most valuable first

**1. The sticky header takes 17% of a desktop screen**: content-first-noise-reduction and state-aware-sticky-headers. 2 points, visual: yes.
- Now: on a desktop the header (title, subtitle and the tab row) stays stuck at the top (`head.html:122-126`). In the 1400×900 picture it is about 155px tall. The phone already makes it non-sticky (`head.html:554`).
- Guide: "Keep every fixed or sticky bar under 12% of the viewport height. Use a single row" and "Hide the top bar … while the user scrolls down and bring it back as soon as they scroll up."
- Also, nothing sets `scroll-padding-top`. The guide says to "Add `scroll-padding-top` to the scrollport … equal or greater than the sticky element's height" so that a focused card is never hidden under the header. `.ms-fold` gets only a 16px `scroll-margin-top` (`head.html:384`).
- Fix: slide the header out of view while scrolling down, using `@container scroll-state(scrolled: bottom)`, and keep it shown while it holds focus (`:focus-within`). Also add `html { scroll-padding-top }` set to the header's height. Scroll-state queries are Chrome 144+ only; other browsers just keep today's header.

**2. The theme ignores the computer's light or dark setting**: dark-mode and dark-mode-toggle. 3 points, visual: yes (only for someone whose computer is set to light).
- Now: `<html data-theme="dark">` is fixed in the markup (`page.html:2`, `home.html:2`), and the root says only `color-scheme: dark` (`head.html:75`). There is no `<meta name="color-scheme">`. The button flips between dark and light and always saves its choice (`head.html:6-11`).
- Guide: "MANDATORY: Declare support for both light and dark themes" with `<meta name="color-scheme" content="light dark">`. Also: "**DO NOT** hardcode `color-scheme: light` or `color-scheme: dark` as the root default", and "If the target matches the current system preference … remove the stored value."
- Fix: follow the computer's setting by default. Keep the two-way button, but have it save only a choice that differs from the computer's (and clear the saved choice when it matches), and pick up changes made in another tab through the `storage` event. The early script that prevents a flash of the wrong theme stays.

**3. A card's pop-up looks like a modal but doesn't behave like one**: accessibility (§12) and declarative-dialog-popover-control. 3 points, visual: no.
- Now: each card's pop-up and the "?" guide are `<div popover role="dialog">` (`page.js:208`, `guide.html:4`), drawn over a 65% black backdrop (`head.html:323`). A popover leaves the page behind it live: Tab can move out of the pop-up onto the cards underneath.
- Guide: "Invoke the dialog using the `.showModal()` method … the browser sets outside content as inert", and to open it from a button: "Use `command="show-modal"`".
- Fix: make each pop-up a `<dialog closedby="any">` opened with `commandfor`/`command="show-modal"`, so clicking outside still closes it. Then update the search box's Enter key (`refresh.html:199`, `showPopover()`) and the reload guard (`refresh.html:246`, `:popover-open`) to match. `closedby` and invoker commands are Chrome 134/135+, which is fine for this page.

**4. The open tab is shown only by colour, and the tab name isn't in the window title**: tabs and accessibility. 2 points, visual: yes (slightly).
- Now: the open tab gets a tinted background, colour and border colour from `:has()` rules (`head.html:146-153`). The link carries no `aria-current`, so a screen reader can't tell which tab is open. The window title stays "name - PM" on every tab (`page.html:8`).
- Guide: "MANDATORY: Do not indicate the selected tab with color alone (WCAG 1.4.1). Add a shape, such as an underline." It adds "DO NOT use `box-shadow` or a background: forced colors mode removes both," and asks to "Update single-page application (SPA) titles during page transitions."
- Fix: a few lines of script that run on `hashchange` and set `aria-current="page"` on the open tab and the tab's name in `document.title`. Then draw a 3px underline from `[aria-current]`.

**5. The phone's tab strip always fades its right end, and never scrolls to the open tab**: tabs. 2 points, visual: yes.
- Now: one fixed mask fades the last 24px on the right (`head.html:567`), even when the strip is scrolled to its end, where it fades Settings. There is no fade on the left side. When the page opens on #links or #settings, the open tab can sit out of view.
- Guide: "fade out each edge of the tablist that has more tabs beyond it" with a scroll-driven animation. Also: "On every selection change, scroll the selected tab into view with `scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' })`."
- Fix: use the guide's two-sided fade (`animation-timeline: scroll(self inline)`), and call that scroll in the same script as finding 4.

**6. The Board has no real headings**: accessibility (headings, landmarks) and card. 2 points, visual: no.
- Now: lane names are `<span class="lane-name">` (`page.js:237`), and card titles are `<p class="card-title">` (`page.js:203, 209`). Each lane is a `<section aria-label>` (`page.js:236`), and so is each tab (`page.html:34-56`). A screen reader's heading list for the Board shows only "Key". Its landmark list shows seven unnamed-looking regions.
- Guide: "Mandatory - Don't use 'fake' headings" and "avoid labeling a `<section>` (which turns it into a `region` landmark)". The card guide says to use `<article>` as the card root, with the title as a heading.
- Fix: make lane names `<h2>` and card titles `<h3>`, keeping today's look, and drop the `aria-label` on the lanes. The fold script reads the lane's name from that label (`refresh.html:112`), so it would need to read it from the heading instead.

**7. Plan's milestone headings sit inside `<summary>`**: accessibility. 2 points, visual: no.
- Now: `<details class="ms-fold"><summary><h3 class="ms-h">…` (`page.js:404`).
- Guide: "Avoid placing headings inside the `<summary>` element: Some browsers still expose this element as a button, which removes all roles from its children including headings."
- Fix: put the heading outside, wrapping a button that shows and hides the body (`aria-expanded`). Or accept that the milestone headings are lost to screen readers. Pick one before building.

**8. The reduced-motion rule is a global switch-off**: motion. 1 point, visual: no.
- Now: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: 0.01ms !important; } }` (`head.html:113-115`).
- Guide: "**DO NOT** globally apply `animation-duration: 0.01ms;` … Keep non-motion transitions (such as `color` or `background-color` changes …) enabled; only dampen or disable spatial movement."
- Fix: delete the global rule. Put the only movement, the Plan arrow's rotate (`head.html:448`), inside `@media (prefers-reduced-motion: no-preference)`.

**9. Small screen-reader slips**: accessibility. 1 point, visual: no.
- The waiting badge is `<span class="badge" aria-label="3 waiting on you">` (`page.js:324`). Guide: "Don't put `aria-label`/`aria-labelledby` on elements that shouldn't be named: Examples include plain `<div>`, `<span>`". Fix: put the words in a `.visually-hidden` span instead.
- The fold button sets both `aria-expanded` and a label that says "Fold" or "Unfold" (`refresh.html:115-116`). Guide: "Don't repeat state information already exposed by ARIA inside the label." Fix: use one fixed label.
- The search box's match count is a live region that changes on every key press (`refresh.html:185`, `page.js:251`). Guide: "Debounce frequently-changing regions." Fix: update it about 300ms after typing stops.

**10. Ctrl+F can't find a card hidden past "Show all N"**: defer-rendering-heavy-content (its pointer to search-hidden-content) and tabs. 2 points, visual: no.
- Now: cards past a lane's first 10 get `.over { display: none }` (`head.html:217`, `refresh.html:143`). On weatherglider, Ideas has 117 cards, so the browser's find-in-page misses most of them.
- Guide: "Use `hidden="until-found"` … still keeping them searchable by the browser's find-in-page feature", and use "the `beforematch` event to sync" the state.
- Fix: hide those cards with `hidden="until-found"`, and on `beforematch` open the lane. The milestone menu also uses `hidden` (`refresh.html:77`), so the two need separating. `until-found` works in Chrome; elsewhere it falls back to plain hidden.

**11. Pop-ups appear and vanish with no transition**: animate-to-from-top-layer and motion. 1 point, visual: yes.
- Now: `.card-modal` and its backdrop have no transition (`head.html:320-323`).
- Guide: "Use `transition-behavior: allow-discrete`, `@starting-style`, and … `overlay` to animate discrete entry and exit states natively."
- Fix: a 0.2s fade, with the scale only under `prefers-reduced-motion: no-preference`. This is optional polish.

## Couldn't verify

- **Speed on weatherglider.** Its page is 3 MB, with 182 cards and 3,119 inline icons (0.9 MB). The hidden tabs, the cards past the first 10 and the 161 pop-ups are all `display: none`, so the browser does little work for them, and I don't expect `content-visibility: auto` to help much. I didn't measure render or tab-switch times, so measure before adding it to the Reports or Docs tabs.
- **Desktop tabs may wrap onto two rows.** `.dk-nav` has `flex-wrap: wrap` (`head.html:142`). The tabs guide says "DO NOT wrap them onto multiple rows". Seven tabs need roughly 780px, so they probably wrap between 701 and 780px wide. No picture was taken at that width.
- **A focused card hidden under the sticky header** (finding 1) comes from reading the code, not from a keyboard test.

## Already good

- The cards follow the card guide's "clickable card" pattern exactly: a stretched `<button>` with `::after`, and focus and hover drawn on the card through `:has()` (`head.html:313-318`).
- The tabs are links in a `<nav aria-label>`, not an ARIA tablist. The tabs guide says "DO NOT use this or the WAI-ARIA tabs pattern for page navigation". The pop-ups open with `popovertarget`, which needs no script, have a visible close button, and are named with `aria-labelledby`.
- `color-scheme` is set on the root, and the saved theme is applied in an inline script before the page paints, which prevents a flash (`head.html:6`).
- The page uses `:focus-visible` throughout, has a skip link, `lang="en"`, `dvh` for the pop-up height, `overscroll-behavior: contain`, and `<details>` for chart tables and Plan folds. Every chart has `role="img"` with a written summary and a data table (`reports.js:290, 312`).
- The phone header is already not sticky, and the phone tab strip already scrolls on one row instead of wrapping.
