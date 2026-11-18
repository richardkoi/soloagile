# Chrome's Modern Web Guidance, for the fleet

Card #253, researched 2026-11-18 from
https://developer.chrome.com/docs/modern-web-guidance (version 1.0), its Get started page,
and the blog post "Top 10 things AI gets wrong in web development".

## What it is

Chrome's team ships a set of agent skills: over 200 short guides by Chrome experts on CSS,
web UI, HTML, JavaScript, Core Web Vitals, accessibility, security and passkeys. It works
through a command-line tool. The skill tells the agent to search for a guide in plain words,
then fetch the one it wants:

    npx modern-web-guidance@latest search "animate a dialog modal backdrop"
    npx modern-web-guidance@latest retrieve "animate-to-from-top-layer"

Search returns each guide's id, description and size, so the agent loads only what fits the
card. A project can name its browser target in CLAUDE.md ("This project's Baseline target is
Baseline 2024"). With no target named, the guides stick to features that are widely
available in every browser.

It installs as a Claude Code plugin:

    claude plugin marketplace add GoogleChrome/modern-web-guidance
    claude plugin install modern-web-guidance@googlechrome

## What Cora and Tobin could use

- **Tobin, building a page:** the guides for what he's building, such as `<dialog>` and
  popovers instead of hand-made overlays, container queries for cards, `dvh` instead of
  `vh` on phones, `content-visibility` for long lists, and `:user-invalid` for forms.
  Several of these fit soloagile's own page, like its pop-ups and its long boards.
- **Cora, designing and checking pictures:** the blog's ten common mistakes make a short
  check list she can apply to any screen:
  1. Dark mode: the `color-scheme` meta tag and `light-dark()` colours, with "follow the
     system" kept as a choice.
  2. Reduced motion: each animation is gated on `prefers-reduced-motion`.
  3. Focus: focus moves into a pop-up and comes back when it closes.
  4. Layout jumps: images and videos have their size set, and phone toolbars don't make the
     page jump.
  5. Forms: hints sit above the field, and errors show only after the field is touched.

## How they'd get it

| Way | What it takes | Fits |
|---|---|---|
| a) Install the plugin as a skill | one install (Rich's yes); Orla's skill pick (#252) already offers installed skills to Cora and Tobin | best: nothing in soloagile changes |
| b) A checklist in Cora's prompt | five lines in `agents/cora.md`, from the list above | works without the install, but gets out of date |
| c) A prompt line telling Tobin to run the search command | one line in `agents/tobin.md` | needs npx and the network on every run |

## Recommendation

**a) Install the plugin, and let Orla pick it for any card with a screen.** It needs no
change to soloagile, because Orla already chooses installed skills per card. Its guides stay
up to date, and Tobin loads only the guide a card needs.

Not tried yet: installing anything needs Rich's yes, so the search and retrieve commands
haven't been run here. The first fleet run on a card with a screen after the install
(#236 or #242) would show whether Orla picks it.
