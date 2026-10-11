# Interaction Motion Patterns

Load only the section matching the interface pattern. These are conditional recipes, not defaults.

## Collections and carousels

- Use a horizontal swipe row for comparable, noncritical peer items when vertical space is scarce. Do not hide comparison-critical or one-off content off-screen. ([carousel layout](https://www.youtube.com/watch?v=14h1VnkQvIc&t=21s))
- Pair paged movement with a continuously updated position indicator. Replace dense dot sets with a count or progress bar.
- Use stretching or merging indicators only when partial progress and direction matter.
- Apply edge scale, rotation, or fade only to decorative or easily recognized items. Never distort readable text or controls.
- Auto-rotate only a small set of brief, equal-weight showcase items. Keep manual controls visible and stop autoplay after user interaction.

## Progressive disclosure

- Establish static hierarchy before animating disclosure. Hidden capabilities must remain discoverable.
- Collapse navigation only when links no longer fit. Collapse search only when search is secondary.
- Use accordions for independently labeled, noncritical sections. Never bury information required for safe task completion.
- Supply tap, keyboard, and visible-label equivalents for hover-only previews.
- Prefer explicit “load more” when users need pacing control or footer access. Endless loading is for continuous-consumption contexts.

## Scroll-linked motion

- Bind effects to native scroll progress without replacing browser scroll physics. Avoid scrolljacking. ([scroll control](https://www.youtube.com/watch?v=HE4rLEQpiXY&t=212s))
- Use scroll control when comprehension pace varies; use time-based playback only when the effect must be seen without scrolling.
- Keep swapping text inside a stable sentence frame and layout. Reject phrase sets that cause reflow or line-count changes.
- Never gate body copy or immediately required information behind a scroll reveal.
- Use parallax only with enough empty space for safe travel. Keep differentials small and remove them under reduced motion.
- Keep image scale and container-morph deltas small; protect meaningful crops and avoid relayout.
- Use stacked panels for a short ordered sequence of substantial items, not randomly accessed peers. Keep headings, prices, and actions visible.
- Preserve a complete static process diagram before layering staged reveals. Do not move nodes whose position encodes meaning.
- Prototype actual scroll behavior and test both fast and slow scrolling before approval.

## Hover, press, keyboard, and cursor

- Give controls immediate press feedback without changing layout or moving neighboring controls.
- Keep label-swap buttons in one clipped axis, prevent wrapping, and preserve focus indicators.
- Make peer controls use consistent hover directions unless direction is an intentional product motif.
- Restrict elaborate fills, morphs, and masked labels to high-priority controls.
- Make pointer and keyboard paths produce the same state and result. Shortcuts are accelerators, not exclusive entry points.
- Follow platform keyboard contracts such as Escape to dismiss and Return to commit, with context-specific exceptions for multiline input.
- Treat toasts as stateful feedback: enter the surface, then reveal pending, success, or error detail. Keep high-frequency notifications restrained.
- Limit magnetic attraction and pointer followers to one or two nonessential elements. Cursor motion must not carry meaning or clickability alone.

## Loops, loaders, and progress

- Keep ambient loops slow, small, and simple. Never perpetually move text, controls, or precision targets.
- Ensure readable marquees remain readable before content exits; decorative text texture may move faster.
- Provide pause, stop, or hide controls for qualifying automatic movement. WCAG 2.2.2 specifically covers motion that starts automatically, lasts more than five seconds, and runs alongside other content. ([W3C 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html))
- Model loading as a real state between action and result, with pending and terminal outcomes.
- Animate determinate progress continuously and keep decorations subordinate to the value.
- Stagger repeating loader elements with a bounded wave; the final element should begin before the first completes.
- Do not add a page loader when the page would otherwise become usable immediately.

## Page entrances and overlays

- Use a page entrance only to cover actual readiness work or deliver a rare justified first impression.
- Keep a preloader to one nonrepeating pass and never longer than the load it conceals. Skip or shorten it on repeat visits.
- Make a full-page loader a top-level fixed sibling with explicit stacking, viewport-safe sizing, and pointer cleanup after exit.
- Move revealed content in the exit direction with smaller travel, overlap the handoff, and reveal primary content before supporting chrome.
- Do not delay navigation in repeat-use or task-first applications.
- Hard-refresh after timing changes; timeline scrubbing cannot expose first-paint flashes or readiness races.
