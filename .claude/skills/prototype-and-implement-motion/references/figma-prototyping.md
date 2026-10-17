# Figma Motion Prototyping

Load this reference when Figma is the chosen validation medium.

## Decide whether Figma is sufficient

Use Figma for discrete states, hierarchy, simple timing, masks, and handoff review. Move to code early when success depends on real data, responsive measurement, velocity, interruption, native scroll, input fidelity, or runtime performance.

## Build states

1. Build the stable final state first.
2. Duplicate the nearest valid state.
3. Change only properties intended to animate.
4. Preserve identical layer names and equivalent parent hierarchy for layers that should Smart Animate.
5. Deliberately break identity when a crossfade or hard swap is correct.
6. Keep persistent containers stable and replace only their inner payload.
7. Reset inherited hover, focus, and highlight properties after duplication.

Authoring the end state first reduces accidental differences between frames. ([mask states](https://www.youtube.com/watch?v=NtZeYmTMuo4&t=566s))

## Construct transitions

- Keep revealing elements in both state trees. Use opacity for fades, small offsets for slide-fades, scale for growth, and off-mask displacement for hard-edged entrances.
- Use small offsets for menus, tooltips, and labels. Reserve off-canvas starts for large panels whose origin matters.
- Attach interactions to the real visual hit container. Use transparent hotspots only when they cannot overlap or swallow other interactions.
- Use hover triggers only for self-reverting pointer states. Validate touch paths through tap interactions.
- Wire both opening and closing directions. Set every trigger explicitly in chained flows.
- Use masks copied from the visible container's exact dimensions and radius; verify layer order.
- Move a layer beyond its mask for travel. Use opacity only when the intended effect is a fade.
- Use matched duplicate frames for single-line text wipes. Avoid this construction for multiline or reflowing text.
- Use instant transitions for intentional holds or invisible state handoffs, not where visible continuity is required.

## Prototype loaders

Represent each meaningful state explicitly:

1. covered or pending;
2. loader exiting;
3. content settled;
4. supporting navigation visible;
5. failure or retry, if the product can fail.

Set the actual initial state as the prototype start. For frame-based rotation, create visible half-turn deltas such as rest → 180° → rest; a visually identical 0° → 360° pair may not animate as intended.

## Validate

- Preview immediately after every connection, naming, timing, and hierarchy change.
- Test the defining two-state transition before replicating it.
- Replay the full chain from its true start, not only adjacent states.
- Test reverse paths, rapid retriggering, and every available input path.
- Compare against an instant version and remove motion that does not improve comprehension.
- Treat the prototype as a behavior specification, not proof of browser or device performance.
