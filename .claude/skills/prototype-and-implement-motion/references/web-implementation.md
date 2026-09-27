# Web Motion Implementation

Load this reference when implementing motion in browser code.

## Build in the correct order

1. Verify stable semantic markup and final visual states.
2. Identify existing duration, easing, spring, and z-index tokens.
3. Choose the least complex tool that satisfies interruption and orchestration needs.
4. Implement one primary transition.
5. Add reduced-motion, input, failure, and no-JS behavior.
6. Measure and profile before adding supporting layers.

Prefer CSS transitions, `@starting-style`, and WAAPI for simple or predetermined motion. Use the product's existing motion library for gesture physics. Use one named GSAP timeline for coordinated multi-step sequences.

## Protect rendering performance

- Prefer `transform` and `opacity`; browsers can often handle them in the compositing stage. Treat `width`, `height`, position, large filters, masks, and large paint areas as profiling triggers. ([web.dev performance guide](https://web.dev/articles/animations-guide))
- Keep clip-path, border-radius, and filter animation restrained.
- Avoid layout reads and writes on every pointer or scroll frame.
- Do not update a parent CSS variable every frame merely to drive child transforms when direct transforms are available.
- Verify with browser performance tools and realistic hardware; “GPU-friendly” is a hypothesis until measured.

## Construct sequences

- Build multi-step choreography as one named, paused timeline triggered by an explicit readiness or interaction signal.
- Use timeline positions and relative offsets for concurrency instead of unrelated delays.
- Group sibling targets in one operation and stagger them; split only when their properties or timing genuinely differ.
- Declare deterministic start and end values for one-shot entrances. Animate from current state for interruptible transitions.
- Let one system own initial hidden states. If CSS hides essential content, activate that state only when JavaScript is known to run or provide a no-JS escape.
- Use a separate overflow-hidden wrapper for clipped text entrances. Keep text layout stationary.
- Implement wipes as positioned overlays or transform masks. Avoid width-based wipes on wrapping text.
- Match solid masks to the underlying surface; do not use them over imagery or transparency they cannot reproduce.

## Measure responsive geometry

- Separate measurement from movement. Resolve geometry first, then build the animation from named values.
- Read actual DOM geometry when distance depends on fonts, content, images, or viewport size.
- Measure only after relevant fonts, images, and layout are ready and while the element is rendered.
- Invalidate geometry on the resize, content, font, or container changes that affect it.
- Prefer percentage transforms when displacement is relative to the moving element's own size.
- Use intrinsic or measured final sizes for expansion. Do not assume `max-width` creates a useful target for elements without intrinsic width.

## Preserve interaction safety

- Keep semantic state, focus order, hit targets, and keyboard availability correct throughout the animation.
- Remove exiting overlays from hit testing at the correct moment; an invisible layer must never capture input.
- Cancel scheduled work and observers when the component unmounts.
- Make rapidly retriggered motion retarget from its current state rather than restart from an unrelated first frame.
- Keep direct-manipulation values synchronous with input and carry release velocity into settling.
- Maintain native scroll behavior for scroll-linked effects.

## Reduced motion

Use the platform preference as a baseline:

```css
@media (prefers-reduced-motion: reduce) {
  .motion-element {
    transform: none;
    transition-duration: 1ms;
  }
}
```

Prefer a short opacity or color change when it preserves state comprehension. Remove parallax, large travel, scroll scrubbing, overshoot, idle loops, and auto-rotation. The media feature is documented by [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion); WCAG 2.3.3 calls for interaction-triggered nonessential motion to be disableable. ([W3C 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html))
