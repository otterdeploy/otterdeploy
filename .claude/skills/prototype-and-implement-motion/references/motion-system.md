# Motion System and Timing

Load this reference when choosing motion character, direction, duration, easing, spring behavior, or continuity.

## Establish the system

- Derive two or three reusable motifs from the product's character or repeated interaction geometry. Translate the principle of a reference, not its exact values. ([motion identity](https://www.youtube.com/watch?v=RCneB_MQ7qs&t=428s))
- Reuse curve families, durations, directions, and motifs at comparable moments. Let urgency and platform convention override brand character. ([gesture systems](https://www.youtube.com/watch?v=14h1VnkQvIc&t=21s))
- Match character to context: hard deceleration can feel efficient, restrained overshoot can feel playful, and longer gentle movement can feel calm. Keep errors, destructive confirmations, and urgent feedback direct.
- Choose the focal point of every beat. Reduce the old focal point as the new one arrives; reject choreography with multiple full-strength competitors. ([focal flow](https://www.youtube.com/watch?v=RCneB_MQ7qs&t=428s))
- Spend custom choreography on one or two signature moments. Keep functional, repeated motion systematic and quiet. ([restraint](https://www.youtube.com/watch?v=VPeTgU7la34&t=279s))

## Choose timing behavior

- Use easing for finite movement. Use linear timing only for genuinely constant progress, rotation, marquees, and continuous loops. ([gesture physics](https://www.youtube.com/watch?v=14h1VnkQvIc&t=21s))
- Start with the product's existing tokens or platform defaults. Treat transcript-derived numbers as tuning ranges, not standards.
- Use ease-out for most entrances and system responses. Use in-out for visible movement between on-screen states. Use an accelerating exit only when the departure itself must recede; never let it delay task feedback.
- Keep hover, press, and compact reveals brief and interruptible. The source corpus commonly starts near 200–300 ms, but frequent controls may need less. ([short reveals](https://www.youtube.com/watch?v=nl8OFGdx75w&t=137s))
- Reserve roughly one-second choreography for rare hero-scale transformations that do not gate interaction. Repeated utility UI should be far shorter. ([shape expansion](https://www.youtube.com/watch?v=d4MF6pdAZNw&t=873s))
- Stagger siblings with short overlaps and bound the total sequence. Reduce offsets as item count grows. ([group stagger](https://www.youtube.com/watch?v=d4MF6pdAZNw&t=936s))
- Delay a later beat rather than stretching its own movement. Direct feedback must begin on the input frame.
- Give layers in one physical gesture a common timing model. Express lead-follow relationships with offsets unless different physics are intentional.

## Use springs deliberately

- Use a spring for direct manipulation, release velocity, interruption, or an object intended to feel physical.
- Prefer an existing spring preset. Tune only when the default visibly fails the intended character. ([spring restraint](https://www.youtube.com/watch?v=NtZeYmTMuo4&t=506s))
- Use overshoot to communicate momentum or play. Remove it from destructive actions, repeated navigation, large surfaces, and collision-prone layouts.
- Evaluate a spring at realistic scale. A configuration that suits a tiny loader tick can be violent on a panel.
- Preserve velocity when a user interrupts or reverses gesture-driven motion.

## Preserve continuity

- Make content follow the triggering gesture's axis and reverse direction and sequence for back navigation. ([gesture continuity](https://www.youtube.com/watch?v=14h1VnkQvIc&t=170s))
- Use direction semantically: lateral motion often communicates progression; vertical motion often introduces a temporary surface. Follow the platform when it disagrees.
- Prefer transforming a real source into its destination over sliding an unrelated page across the viewport. Reject shared-element motion when it implies a false relationship.
- For card-to-detail transitions, transform the source or a proxy container, preserve a stable image layer where possible, then reveal destination text. Never stretch live text.
- Keep one recurring anchor or mask across step changes when it genuinely bridges the states.
- Animate supporting content out of emphasis while the new focal surface arrives. Persistent information must remain readable.
- Preserve a continuous handoff when a compact trigger expands into a control; do not swap visually related objects as unrelated layers.

## Direct manipulation

- Bind visual progress continuously to drag input. Settle only after release.
- Carry release velocity into the result and decelerate toward a snap point.
- Make dismissal the spatial inverse of opening when that relationship is meaningful.
- Offer gestures as accelerators, never as the sole route to primary or destructive actions.
- Resolve conflicts with scrolling, system navigation, selection, and dismissal before adding a custom gesture.
- Do not use easy drag commitment for irreversible actions.

## Tensions to decide explicitly

- Consistency versus character: favor consistency in dense functional UI; allow character in sparse illustrative scenes.
- Preset versus custom physics: favor established tokens; document rare signature exceptions.
- User-controlled versus autoplay: favor control; allow brief autoplay only for small, noncritical showcase sets with manual controls.
- Design-tool versus code prototype: use Figma for discrete state and handoff questions; move to code when real geometry, data, interruption, input fidelity, or performance determines success.
