# Motion Validation

Load this reference before approving or handing off motion.

## Purpose and restraint

- Compare the animated transition with an instant state change. Keep motion only when it improves continuity, hierarchy, feedback, progress, or orientation.
- Remove one animated layer at a time and replay. Delete layers whose absence does not harm the explanation.
- Replay entrances and one-shot morphs several times. Shorten or remove anything tiring by the second or third viewing.
- Confirm the result or useful content appears early and interaction is not artificially delayed.

## Interaction matrix

Test every applicable combination:

| Dimension | Cases |
| --- | --- |
| Input | mouse, touch, keyboard, assistive path |
| Timing | normal, rapid repeat, interruption, reversal |
| Layout | narrow, wide, content expansion, localization stress |
| State | success, pending, error, cancellation, retry |
| Preference | default motion, reduced motion |
| Runtime | first load, repeat visit, slow device, busy main thread |

Verify that a prototype does not work only at presentation pace.

## Accessibility

- Make nonessential interaction-triggered movement disableable or replace it with an equivalent non-motion state change. ([W3C 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html))
- Provide pause, stop, or hide controls where automatic movement meets WCAG 2.2.2 conditions. ([W3C 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html))
- Keep focus visible and stable. Do not focus elements that are still hidden, inert, or off-screen.
- Ensure invisible and exiting layers do not intercept pointer or keyboard input.
- Preserve a visible alternative for hover and gesture interactions.
- Check flashing content separately against WCAG seizure thresholds; reduced motion alone is not a substitute.

## Performance and layout

- Confirm no unintended layout shift occurs at start, interruption, or completion.
- Profile sustained and scroll-linked effects on representative hardware.
- Inspect long tasks, frame drops, paint areas, and repeated geometry reads.
- Hard-refresh page entrances to reveal first-paint flashes and readiness races.
- Confirm exported media remains sharp at intended pixel density and does not block useful content.

## Feel-check

- Watch once at real speed before using slow motion.
- Then slow or scrub frame by frame to find discontinuities, wrong origins, and competing focal points.
- Test gestures on a physical device.
- Review again after a break; familiarity can hide excessive duration and repetition.
- If feel remains uncertain, document the uncertainty and the exact live test needed instead of claiming proof from code.

## Handoff checklist

- Motion purpose and trigger are named.
- Before, after, pending, and failure states are defined where relevant.
- Curves, durations, springs, delays, and overlaps use named tokens or explicit values.
- Interruption and reverse behavior are specified.
- Reduced-motion, touch, keyboard, and no-JS behavior are specified.
- Source code or prototype contains no invisible interactive leftovers.
- Validation results and remaining feel-checks are reported.
