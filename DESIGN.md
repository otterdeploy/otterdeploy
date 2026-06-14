---
name: otterdeploy
description: A self-hostable deployment platform — calm, confident infrastructure for developers and platform teams.
colors:
  primary: "oklch(0.488 0.243 264.376)"
  primary-dark: "oklch(0.424 0.199 265.638)"
  background: "#fbfbfa"
  background-dark: "#0c0c0b"
  surface: "#ffffff"
  surface-dark: "#161614"
  ink: "#141412"
  ink-inverse: "#f5f5f0"
  muted-ink: "#7a7a74"
  muted-ink-dark: "#7a7a72"
  border: "rgba(20,20,18,0.09)"
  border-dark: "rgba(255,255,250,0.08)"
  input: "rgba(20,20,18,0.12)"
  destructive: "#b42318"
  destructive-dark: "#f87171"
  success: "#1f7a3f"
  success-dark: "#4ade80"
  warning: "#8a6a00"
  warning-dark: "#fbbf24"
  info: "#1f5fa8"
  info-dark: "#60a5fa"
typography:
  display:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.005em"
    fontFeature: "cv11, ss01"
  label:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "-0.005em"
  mono:
    fontFamily: "Geist Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "zero, ss03"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink-inverse}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-primary-hover:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink-inverse}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.destructive}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  input-default:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "4px 10px"
  card-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  badge-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink-inverse}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
---

# Design System: otterdeploy

## 1. Overview

**Creative North Star: "The Quiet Instrument"**

otterdeploy is a precision tool that disappears into the hand. You feel the craft — the hairline rings, the slashed-zero monospace, the 1px nudge a button makes when you press it — but you never notice it, because nothing competes with the task. This is a dashboard for operating real production infrastructure: builds, deploys, networking, logs, backups. The interface earns trust by being calm, fast, and honest, not by being loud. Every pixel serves the operator who is in flow, returning many times a day.

The palette is a **warm-neutral monochrome** — near-blacks with a faint warm cast (`#141412`, not pure black) on a soft warm off-white (`#fbfbfa`, not pure white). A single OKLCH blue is the only chromatic voice, reserved for primary actions and current selection. State is carried by a tight semantic vocabulary (success/warning/info/destructive) that reads identically in light and dark. Typography is one family, Geist, in two cuts: the variable sans for everything human-readable, the mono for everything machine-readable (IDs, hashes, logs, command output) with slashed zeros so `0` and `O` never blur.

This system explicitly rejects the **cluttered self-host UI** (Portainer/Coolify density-without-polish), the **enterprise cloud console** (AWS-style gray walls of nested config with no hierarchy), and the **generic AI-SaaS template** (cream backgrounds, gradient text, hero-metric blocks, identical icon-card grids, eyebrow kickers). It is a serious instrument for builders, never consumer-playful or marketing-bright.

**Key Characteristics:**
- Warm-neutral monochrome surfaces; one OKLCH blue accent on ≤10% of any screen.
- One type family (Geist sans + Geist mono), tight negative tracking, fixed rem scale — no fluid headings.
- Flat by default: separation comes from hairline rings, not drop shadows.
- Dense but orderly; legibility is never traded for compactness.
- Semantic state color (success/warning/info/destructive) is standardized and theme-symmetric.
- First-class dark mode, held to the same contrast bar as light.

## 2. Colors

A warm-neutral monochrome canvas with exactly one chromatic accent. The greys carry a faint warm cast; the blue carries everything that means "action" or "now."

### Primary
- **Signal Blue** (`oklch(0.488 0.243 264.376)`; dark: `oklch(0.424 0.199 265.638)`): The sole chromatic voice. Used only for primary buttons, the current selection/active nav item, focus rings, links, and create-pending state on the project graph. Never decorative. The sidebar's active state uses a slightly brighter cut (`oklch(0.546 0.245 262.881)` / dark `oklch(0.623 0.214 259.815)`).

### Neutral
- **Warm Ink** (`#141412`; inverse `#f5f5f0`): Primary text and the darkest chart step. A warm near-black, never pure `#000`.
- **Muted Ink** (`#7a7a74`; dark `#7a7a72`): Secondary text, placeholders, captions, inactive nav labels. Must still clear 4.5:1 on its surface — bump toward Warm Ink before going lighter.
- **Soft Canvas** (`#fbfbfa`; dark `#0c0c0b`): The body and sidebar background — they share one surface, not two tones.
- **Raised Surface** (`#ffffff`; dark `#161614`): Cards, popovers, dialogs, menus — the one step lifted off the canvas.
- **Hairline** (`rgba(20,20,18,0.09)`; dark `rgba(255,255,250,0.08)`): All borders and dividers. A transparency of the ink, never a separate grey.
- Greyscale chart ramp runs from Muted Ink through to Warm Ink (`#a8a8a0 → #7a7a74 → #4a4a46 → #2a2a26 → #141412`) — data viz stays monochrome unless a category color is earned.

### Semantic (state, not decoration)
- **Destructive** (`#b42318`; dark `#f87171`): Errors and dangerous actions. Rendered as a **tint** (`destructive/10` bg + destructive text), not a solid red fill, except on the most dangerous confirmations.
- **Success** (`#1f7a3f`; dark `#4ade80`): Healthy/running/deployed.
- **Warning** (`#8a6a00`; dark `#fbbf24`): Pending, degraded, propagating, attention-needed.
- **Info** (`#1f5fa8`; dark `#60a5fa`): Neutral informational state and notices.

### Named Rules
**The One Voice Rule.** Signal Blue appears on ≤10% of any given screen. It marks the primary action and the current selection — nothing else. Its rarity is what makes it read as "do this."

**The Warm-Black Rule.** No pure `#000` and no pure `#fff` anywhere. Ink is `#141412`, canvas is `#fbfbfa`. The faint warmth is the whole point; pure values read as cheap.

**The State-Tint Rule.** Semantic color signals state through a low-opacity tint of its own hue plus same-hue text (`bg-destructive/10 text-destructive`), not a saturated fill. Reserve solid fills for the single most consequential action on a screen.

## 3. Typography

**Display / Body / Label Font:** Geist Variable (with `ui-sans-serif, system-ui, sans-serif`)
**Mono Font:** Geist Mono Variable (with `ui-monospace, SFMono-Regular, Menlo, monospace`)

**Character:** One family, two cuts. Geist sans is neutral, modern, and tightly tracked — confident without personality cosplay. Geist mono handles everything machine-generated. Base size is `15px`; body runs at `0.875rem`. Global tracking is a subtle `-0.005em`, with `cv11` + `ss01` features on for a cleaner single-story `a` and alternates. This is a **product** type system: fixed rem scale, tight ratio (~1.15–1.2), no fluid clamp headings.

### Hierarchy
- **Display** (600, ~1.5rem/24px, -0.02em): Page titles, the largest heading in any view. The ceiling — this system never shouts.
- **Title** (600, ~1.125rem/18px, -0.015em): Section and card headings, dialog titles.
- **Body** (400, 0.875rem/14px, 1.5): Default running text and most UI copy. Prose caps at 65–75ch; data and tables may run denser (120ch+).
- **Label** (500, ~0.8rem/13px): Buttons, form labels, nav items, table headers. Medium weight is the UI default.
- **Mono** (400, ~0.8125rem/13px, `zero` + `ss03`): IDs, hashes, env keys, log lines, command output, metrics. Slashed zero + stylistic set so `0`/`O` and `1`/`l`/`I` never blur.

### Named Rules
**The Two-Cuts Rule.** Sans for the human, mono for the machine. Anything a user could copy and paste into a terminal — an ID, a hash, a domain, a log line — is mono. Everything else is sans. No third font, ever.

**The Fixed-Scale Rule.** No `clamp()` headings in product UI. Users view at consistent DPI; a heading that shrinks inside a sidebar looks broken, not responsive.

## 4. Elevation

Flat by default. Depth is communicated by **hairline rings and tonal layering**, not drop shadows. A card is `bg-card` lifted off the canvas by a single `ring-1 ring-foreground/10` — no shadow at rest. Shadows are an exception reserved for genuinely floating layers: dropdown menus, popovers, dialogs, the toast stack, and the React Flow graph's controls/minimap. This keeps the surface quiet and avoids the "2014 app" look where every card sits on a soft grey halo.

### Shadow Vocabulary (floating layers only)
- **Lifted surface** (`0 1px 2px 0 oklch(0 0 0 / 6%), 0 0 0 1px oklch(from var(--foreground) l c h / 4%)`): Graph nodes and lightly raised elements — a near-invisible seat, mostly a tonal ring.
- **Floating panel** (`0 1px 2px 0 oklch(0 0 0 / 6%), 0 8px 24px -12px oklch(0 0 0 / 24%)`): Menus, popovers, the graph controls/minimap — clearly detached from the canvas.

### Named Rules
**The Flat-By-Default Rule.** Resting surfaces have no drop shadow. If a card needs a shadow to be distinguishable, the ring (`ring-foreground/10`) or background tone is wrong — fix that first. Shadows mean "floating above the page," not "is a card."

**The Ring-Not-Border Rule.** Card separation uses `ring-1 ring-foreground/10` (a transparency of the ink), so it reads as a hairline regardless of theme. Audit test: if a divider looks grey rather than like a faint edge of the ink, it's a hardcoded grey — replace it.

## 5. Components

The vocabulary is built on Base UI primitives styled with Tailwind v4 tokens. Every interactive component ships default, hover, focus-visible, active, disabled, and (where relevant) error and loading states. Consistency screen-to-screen is the virtue.

### Buttons
- **Shape:** `rounded-lg` (0.625rem); compact sizes step down to ~10–12px corners.
- **Size:** Default `h-8` (32px), `px-2.5`, `text-sm`, `font-medium`. Sizes: `xs` (h-6), `sm` (h-7), `lg` (h-9), plus square `icon` variants. Icons are 16px (smaller in compact sizes), with auto inline-start/end padding adjustment.
- **Primary:** `bg-primary text-primary-foreground` (Signal Blue). The one solid-fill action per context.
- **Outline:** `border-border bg-background`, hover → `bg-muted`; in dark, a faint `bg-input/30` fill.
- **Secondary:** `bg-secondary` (a 4% ink tint), hover → `/80`.
- **Ghost:** Transparent, hover → `bg-muted`. The default for toolbar and low-emphasis actions.
- **Destructive:** Tinted, not solid — `bg-destructive/10 text-destructive`, hover `/20`. (See The State-Tint Rule.)
- **Hover / Focus / Active:** `transition-all`; focus-visible draws `border-ring` + `ring-3 ring-ring/50`; active nudges `translate-y-px` (a tactile press, suppressed on menu triggers). Disabled → `opacity-50`, no pointer events.
- **Invalid:** `aria-invalid` paints destructive border + ring automatically.

### Inputs / Fields
- **Style:** `h-8`, `rounded-lg`, `border-input`, `bg-transparent` (dark: `bg-input/30`), `px-2.5`. Placeholder uses Muted Ink at full 4.5:1.
- **Focus:** `border-ring` + `ring-3 ring-ring/50` — the same focus signature as buttons.
- **Disabled:** `bg-input/50`, `opacity-50`, `cursor-not-allowed`.
- **Error:** `aria-invalid` → destructive border + ring.

### Cards / Containers
- **Corner Style:** `rounded-lg` (0.625rem).
- **Background:** `bg-card` (Raised Surface), one step off the canvas.
- **Shadow Strategy:** None at rest — `ring-1 ring-foreground/10` only (see Elevation).
- **Internal Padding:** `py-4` / `px-4` default; `sm` size steps to `py-3` / `px-3`. Header/content/footer gap is `gap-4` (sm: `gap-3`).
- **Never nest cards.** A card inside a card is always wrong here — use a divider or tonal section instead.

### Badges / Chips
- **Shape:** Pill (`rounded-4xl`), `h-5`, `px-2`, `text-xs`, `font-medium`. Icons 12px.
- **Variants:** default (Signal Blue), secondary (ink tint), destructive (tint), outline, ghost, link. Used for status, counts, and tags — the primary carrier of the semantic state vocabulary.

### Navigation
- **Sidebar:** Shares the canvas background (`--sidebar` = `--background`) — not a separate panel tone. Labels in Muted Ink (`--sidebar-foreground`), `font-medium`. Active item uses the brighter sidebar-primary blue; hover → `bg-accent` (4% ink tint). Keyboard-navigable, visible focus.
- **Tabs / breadcrumbs:** Quiet by default; active state is weight + Signal Blue underline/marker, never a heavy filled pill.

### Signature: The Project Graph (React Flow)
otterdeploy's distinctive surface. Nodes are card-like (`rounded`, hairline ring, the Lifted-surface shadow), edges are `1.25px` Muted Ink. The library's CSS variables are remapped to our tokens so the canvas themes light/dark natively. Pending state is shown with the **comet border** — a single bright segment with a fading tail travels the node's rounded ring (blue for pending-create, the destructive red for pending-delete) via an animated `@property` angle, so the ring stays fixed and only the light moves. Honor `prefers-reduced-motion` with a static ring.

## 6. Do's and Don'ts

### Do:
- **Do** keep Signal Blue to ≤10% of any screen — primary action and current selection only (The One Voice Rule).
- **Do** use `#141412` for ink and `#fbfbfa` for canvas; never pure black or white (The Warm-Black Rule).
- **Do** render state as a tint of its own hue plus same-hue text (`bg-destructive/10 text-destructive`), reserving solid fills for the single most consequential action.
- **Do** set every machine-readable string — IDs, hashes, domains, env keys, log lines — in Geist Mono with slashed zero (The Two-Cuts Rule).
- **Do** separate surfaces with `ring-1 ring-foreground/10`; flat at rest, shadows only on floating layers (The Flat-By-Default Rule).
- **Do** pair semantic color with an icon and label so state never depends on color alone (color-blind operators, WCAG).
- **Do** use 150–250ms `transition-all`, skeletons over spinners, and the active `translate-y-px` press; honor `prefers-reduced-motion` on every animation including the comet border.
- **Do** design every state — loading, pending, degraded, error, empty, success — truthfully. Empty states teach the interface.

### Don't:
- **Don't** build the **cluttered self-host UI** — density without hierarchy, utilitarian noise (Portainer/Coolify-rough). Density is fine; noise is not.
- **Don't** build the **enterprise cloud console** — gray walls of nested config, endless tabs, no sense of state (AWS/GCP-style).
- **Don't** reach for the **generic AI-SaaS template**: cream/sand backgrounds, gradient text (`background-clip: text`), hero-metric blocks, identical icon-card grids, or a tracked-uppercase eyebrow above every section.
- **Don't** introduce a second accent hue or a third font family. One blue, one family in two cuts.
- **Don't** put drop shadows on resting cards, or use `border-left`/`border-right` >1px as a colored accent stripe — full hairline rings or tonal tints instead.
- **Don't** nest a card inside a card.
- **Don't** use `clamp()` / fluid headings in product UI (The Fixed-Scale Rule).
- **Don't** ship fake, mock, or seeded data; unbuilt features show a "Coming soon" placeholder, never invented content.
- **Don't** let Muted Ink body text drop below 4.5:1 on its surface in either theme.
