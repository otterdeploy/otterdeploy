---
name: generate-and-refine-ui-with-ai
description: Use when generating product UI with Claude or another coding model, rescuing a vibe-coded interface, or explaining a UI redesign through screenshots, reference research, prompts, and before-to-after decisions.
---

# Generate and refine UI with AI

Produce a visual design argument, not a bag of tips. Every important change must connect a visible problem to the screen's job, an intervention, and evidence that the intervention improved it.

## Choose the path

- For a new AI-generated screen, read [Claude dashboard case study](references/claude-dashboard-case-study.md).
- For an existing weak product UI, read [vibe-coded SaaS rescue](references/vibe-coded-saas-rescue.md).
- For JSX/CSS patterns used during refinement, read [implementation recipes](references/implementation-recipes.md).
- Use [teachings.jsonl](references/teachings.jsonl) only as a lookup corpus. Search it by the problem terms, for example `rg -ni 'sidebar|navigation|account' references/teachings.jsonl`; do not dump it into the answer.

## Capture evidence

For a live local UI, use the available browser or computer-control tool to navigate to the exact state and capture it. For a remote product, use an authenticated browser session when one is available. If the user supplied an image, preserve the original and work from a copy. If none of these paths exists, continue with a clearly labelled hypothesis and state which screenshot or render is still needed.

Store project evidence consistently when filesystem access is available:

```text
design-evidence/<screen>/<step>-<stage>-<state>-<viewport>.png
design-evidence/dashboard/01-before-loaded-1440x900.png
design-evidence/dashboard/02-intervention-loaded-1440x900.png
design-evidence/dashboard/03-after-loaded-1440x900.png
```

Keep viewport, data, route, theme, and UI state identical for before/after comparisons. Record any unavoidable difference in the ledger.

## Build the evidence trail

Start with the actual screen or the nearest available screenshot. Preserve it as `before`; do not overwrite it. If the interface has several states, capture the state that best exposes the problem.

Write one sentence for the screen's job:

> When **[user]** opens this screen, they need to **[decision/action]** using **[essential information]**.

Diagnose against that job. Do not say only that a screen is “ugly,” “generic,” or “AI-looking.” Name observable evidence and its consequence:

- hierarchy: the wrong thing wins first attention;
- information: required context is absent, duplicated, or decorative;
- layout: related items are separated or unrelated items are grouped;
- interaction: the container, control, or state does not fit the task;
- system: type, spacing, color, icon, or state semantics drift;
- trust: the UI looks unfinished, contradictory, or implausible for the product.

For each material change, maintain this ledger:

| Stage | Screenshot | Observation | Intended job | Change | Why it should work | Verification |
|---|---|---|---|---|---|---|
| Before | path/link | visible fact | user outcome | — | — | baseline |
| Intervention | path/link | hypothesis | same outcome | exact edit | causal reason | what to inspect/test |
| After | path/link | visible result | same outcome | retained edit | evidence | pass/fail/next issue |

## Search references by problem

Search for product behavior before visual mood. On Mobbin or another product library, combine the product category, user task, and surface: `project management + project overview`, `URL shortener + create link`, `billing + plan comparison`, or `analytics + geography`.

Collect references in three lanes:

1. **Product precedent** — a real shipped product solving the same task.
2. **Interaction precedent** — the specific component or state, such as an account switcher, dense data row, modal form, or progress timeline.
3. **Visual direction** — typography, color, surface treatment, and density.

For every saved reference, record `borrow`, `reject`, and `reason`. Reject a reference when its density hides the hierarchy, its product model differs from the brief, or its polish depends on details the generator cannot reliably infer. A reference is evidence, not permission to copy a whole screen.

If Mobbin or another library is login-gated, use an existing authenticated browser session only when available. Otherwise search public product pages, official documentation, public design-system examples, or ask the user for the specific reference screenshot. Never invent a reference you could not inspect; log the access limitation and the fallback source.

## Construct the generation brief

Resolve conflicts between the written brief and images before prompting. Use this order:

```text
Design and implement [screen] for [product and user].

User job:
- [decision/action the screen must support]

Required information and actions:
- [region, data, primary action, state]

Interaction rules:
- [responsive, loading, empty, error, hover/focus, keyboard behavior]

Visual direction from the references:
- Borrow: [specific hierarchy, density, surface, or component behavior]
- Do not copy: [irrelevant structure or decoration]
- Avoid: emoji UI icons, arbitrary gradients, duplicate filler blocks

Implementation constraints:
- [framework and existing design tokens]
- Use one interface icon library
- Return editable HTML/CSS when HTML-to-Figma conversion is required

Acceptance checks:
- [three observable conditions that prove the screen works]
```

Name the product purpose and user outcome before appearance. Name essential regions and visualizations explicitly. Leave nonessential styling open only when exploration is useful.

## Compare generations, then intervene

Generate alternatives when reference choice or layout is uncertain. Compare them against the same screen job; do not select by vibe alone. A visually dense reference often causes the model to omit small but important structure. A simpler production reference may transfer hierarchy more faithfully.

Keep generated behavior that supports the workflow. Re-decide hierarchy, density, arrangement, and container choice yourself. Fix in this order:

1. missing or duplicated information;
2. page structure and interaction container;
3. alignment, spacing, and type hierarchy;
4. semantic color and contrast;
5. icons, texture, and decorative polish.

Prefer high-leverage edits. Replace decorative KPI icons with trend data. Move repeated secondary actions into an overflow menu. Use a modal for a short self-contained form and a side panel when page context or vertical length matters. Replace vague progress words with measured values when measurement is honest.

## Verify the after-state

Capture the same viewport and state after refinement. Compare before and after side by side. The after-state should answer more user questions, reduce ambiguity, or shorten the path to action—not merely contain fewer elements.

Check real content, overflow, responsive widths, keyboard and focus behavior, loading/empty/error states, status meaning, compact-element contrast, and icon consistency. Report unresolved problems instead of polishing them out of the narrative.

## Required deliverable

Return:

1. the screen job;
2. annotated before evidence;
3. reference-search log with accept/reject reasoning;
4. prompt or implementation artifact;
5. the change ledger;
6. after evidence at the same state and viewport;
7. validation results and remaining risks.

Never present an unsupported makeover. If no screenshot or render is available, say that the redesign is a hypothesis and identify what must be captured before it can be verified.
