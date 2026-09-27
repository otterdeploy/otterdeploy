---
name: prototype-and-implement-motion
description: Design, prototype, or implement product motion in Figma or web code. Use for interaction transitions, shared-element continuity, gestures, loaders and progress, scroll-linked sequences, page entrances, microinteractions, and motion-system decisions. Produces a motion brief, a testable Figma prototype, or production CSS, WAAPI, or GSAP code. Do not use for a read-only motion audit or a general static UI redesign.
---

# Prototype and Implement Motion

Turn a known interface state change into purposeful, testable motion. Work inside the existing product structure and visual system. Do not use animation to repair unclear hierarchy, invent navigation, or conceal latency.

## Boundaries

This skill owns motion intent, choreography, prototyping, implementation, and motion-specific validation.

- For a read-only review of existing animation code, use a motion-review skill.
- For a codebase-wide audit or backlog, use a motion-audit skill.
- For static hierarchy, layout, colour, or typography changes, use the relevant visual-design skill first.
- For a component whose accessibility contract is not already solved, select or build the component before animating it.

## Hard rules

1. Name the job before choosing a curve: feedback, continuity, spatial orientation, state change, hierarchy, progress, or deliberate delight. If none applies, do not animate.
2. Start from explicit before and after states. Never choreograph an undefined transition.
3. Reveal useful content early. Motion must not delay navigation, feedback, or task completion merely to create suspense.
4. Default to restrained amplitude and duration. Reserve bespoke choreography for one or two signature moments.
5. Keep direct manipulation coupled to input. Apply easing only after release or when the system takes over.
6. Preserve semantic and spatial truth. Shared-element motion must connect genuinely related objects; diagrams must not move nodes whose positions encode meaning.
7. Provide visible non-hover and non-gesture routes for every meaningful action.
8. Ship reduced-motion behavior, interruption handling, focus safety, and pointer cleanup with the motion.
9. Prefer transforms and opacity. Treat layout, filter, mask, and large paint-area animation as performance risks requiring verification.
10. Judge at real speed on realistic hardware. Numeric values and static frames cannot prove that motion feels right.

## Workflow

Follow these steps in order. The first two may legitimately end with no animation.

### 1. Frame the transition

Record:

- **Purpose:** what the motion explains.
- **Trigger:** entrance, pointer, press, keyboard, scroll, timer, or direct gesture.
- **Frequency:** constant, frequent, occasional, or rare.
- **States:** stable before state, stable after state, and any meaningful pending or error state.
- **Focal handoff:** what has attention before and after.
- **Constraints:** platform convention, input methods, reduced motion, real data, responsive geometry, loading, and interruption.

Reject motion when the state change is already obvious, the action is extremely frequent, the content must remain stationary for reading or comparison, or animation would mask a structural problem.

### 2. Choose the deliverable and tool

Use the cheapest medium that can answer the uncertain question:

| Need | Deliverable or tool |
| --- | --- |
| Communicate intent or hand off behavior | Motion brief and beat table |
| Validate discrete states, hierarchy, or simple timing | Figma prototype |
| Validate real layout, input, interruption, scroll, or performance | Browser prototype or production code |
| Simple hover, press, reveal, or controlled state change | CSS transition or `@starting-style` |
| Predetermined self-running sequence | CSS keyframes or WAAPI |
| Coordinated multi-step timeline | One named GSAP timeline |
| Gesture physics or continuously interruptible values | Existing product motion library or platform-native primitive |
| Effect native UI cannot reproduce reasonably | Canvas, 3D, or exported media, with a fallback |

Read [motion-system.md](references/motion-system.md) before setting timing, direction, easing, springs, or continuity. Read only the implementation reference that matches the chosen medium.

### 3. Write the motion contract

Define each beat before building it:

| Field | Required decision |
| --- | --- |
| Trigger | Exact event and input methods |
| Source → destination | Stable states and spatial relationship |
| Focal handoff | Element losing attention → element gaining it |
| Layers | What moves, stays fixed, enters, and exits |
| Properties | Transform, opacity, mask, or justified exception |
| Timing | Duration, easing or spring, delay, and overlap |
| Interruption | Retarget, reverse, settle, cancel, or ignore |
| Fallback | Reduced motion, no-JS, touch, keyboard, and failure state |

Use one row per beat. Remove any beat that does not improve comprehension when compared with an instant state change.

### 4. Build the smallest convincing version

- **For interaction and product patterns:** read [interaction-patterns.md](references/interaction-patterns.md), then implement only the relevant pattern.
- **For Figma:** read [figma-prototyping.md](references/figma-prototyping.md). Prototype the defining transition first, preserve layer identity deliberately, and preview after every structural change.
- **For web code:** read [web-implementation.md](references/web-implementation.md). Stabilize final markup and states first, reuse existing tokens and libraries, then add motion.

Do not build every decorative layer at once. Establish the primary handoff, test it, then add supporting motion one layer at a time.

### 5. Validate and prune

Read [validation.md](references/validation.md) and run the checks appropriate to the deliverable. At minimum:

1. Compare animated and instant versions.
2. Replay frequent and one-shot motion repeatedly.
3. Interrupt and reverse it at awkward moments.
4. Test mouse, touch, keyboard, narrow layouts, reduced motion, and slow hardware where applicable.
5. Remove one animated layer at a time; keep only layers whose absence harms the explanation.

## Evidence lookup

Use [sources.md](references/sources.md) for the chapter index. Use [teachings.jsonl](references/teachings.jsonl) only when a precise claim, exception, or citation is needed; it contains 378 evidence records and is intentionally not loaded by default.

Search it rather than reading it whole:

```bash
rg -ni 'gesture|swipe|carousel|shared element' references/teachings.jsonl
rg -ni 'scroll|parallax|morph|diagram' references/teachings.jsonl
rg -ni 'figma|smart animate|prototype|mask' references/teachings.jsonl
rg -ni 'css|gsap|timeline|geometry|performance' references/teachings.jsonl
rg -ni 'loader|progress|entrance|toast|cursor' references/teachings.jsonl
```

Treat numeric values from the evidence ledger as starting points unless the product already has motion tokens or an authoritative platform standard.

## Output

Deliver the artifact the user requested, then summarize briefly:

- purpose and trigger;
- chosen medium and why;
- motion contract or implemented values;
- reduced-motion and interruption behavior;
- what was tested and what still requires a feel-check.

When implementation is requested, the code or working prototype is the deliverable—not a long motion essay.
