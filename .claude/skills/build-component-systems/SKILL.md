---
name: build-component-systems
description: "Load when an agent must turn recurring interface decisions into consistent tokens, components, variants, and reusable rules."
---

## Operating workflow

- Settle the user flow and realistic content before applying the component system; consistency cannot repair unresolved structure or placeholder-driven layouts. ([system](https://www.youtube.com/watch?v=ADaQuZS04Rc&t=206s))
- Extract spacing, type, colour roles, and interaction patterns from several real screens before formalising them; do not invent foundations in isolation. ([foundations](https://www.youtube.com/watch?v=HE4rLEQpiXY&t=269s))
- Enforce a small set of decisions everywhere before expanding the library. Ten dependable rules create more predictability than a hundred inconsistently used components. ([system](https://www.youtube.com/watch?v=ADaQuZS04Rc&t=206s))
- Match system depth to organisational maturity: keep early systems thin and replaceable, then add rigorous specifications as products, teams, and dependencies grow. Fails when “lightweight” becomes an excuse for permanent under-investment. ([scope](https://www.youtube.com/watch?v=HE4rLEQpiXY&t=269s))
- Document decisions and rationale with the people who will consume the system, but always ship usable tokens and components rather than letting governance become the deliverable. ([scope](https://www.youtube.com/watch?v=HE4rLEQpiXY&t=269s))
- Judge the system by whether contributors share a vocabulary for assembling UI, not whether every surface is visually identical. Fails when contextual variation becomes cover for arbitrary one-offs. ([scope](https://www.youtube.com/watch?v=HE4rLEQpiXY&t=269s))
- Build new surfaces from existing components and spacing tokens first. Extend the system when a genuinely new interaction appears; never distort an existing component merely to avoid adding one. ([system](https://www.youtube.com/watch?v=ADaQuZS04Rc&t=206s))
- Apply the same component geometry, spacing, type scale, and colour roles across unrelated product areas so the system remains recognisable beyond a single flow. ([system](https://www.youtube.com/watch?v=ADaQuZS04Rc&t=206s))
- Classify recurring regions as cards, lists or tables, inputs or forms, and tabs before inventing layout. Fails for genuinely bespoke surfaces such as maps, canvases, or timelines. ([dashboard](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=352s))
- Compose complex surfaces by nesting primitives—forms in cards, tables in tabs, lists in modals—but stop when nested boundaries cease to communicate meaningful grouping. ([dashboard](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=352s))
- Make every departure explicit: name the broken rule, explain the need, and make the reasoning reviewable. Fails when “intentional” becomes an unchallenged rubber stamp. ([scope](https://www.youtube.com/watch?v=HE4rLEQpiXY&t=269s))
- Treat early-system disposability and mature-system stability as a tension to judge: favour loose coupling while direction changes, then favour compatibility once downstream teams depend on the contract. ([scope](https://www.youtube.com/watch?v=HE4rLEQpiXY&t=269s))
- Encode settled decisions as named colour styles, variables or tokens, and components used more than once. Delay this during open-ended exploration, then componentise as soon as the direction stabilises. ([consistency](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=168s))
- Review every recurring component on two independent axes: visual fit and behavioural correctness. A polished component with the wrong states or actions still fails. ([refitting](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=0s))
- Compare new screens with existing screens of the same class, and compare redesigns with their predecessors at identical dimensions. Judge family resemblance and hierarchy through direct contrast. ([system](https://www.youtube.com/watch?v=ADaQuZS04Rc&t=206s)) ([cards](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=270s))
- Audit one property across the entire product at a time—radii, spacing, type sizes, colour roles, then icons—because screen-by-screen review conceals drift. Fix inconsistency before adding decorative polish. ([consistency](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=168s))

## Spacing and size tokens

- Choose a 4px or 8px base unit and express component gaps, padding, and margins as multiples of it. Permit explicit optical corrections and avoid forcing large dimensions onto the grid when no alignment depends on them. ([spacing](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=366s))
- Configure the design tool’s small-nudge increment to match the active file’s base unit. Fails when a global setting is used across files with different grids. ([spacing](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=366s))
- Audit spacing mechanically by dividing values by the base unit; investigate values that do not divide cleanly, but preserve documented optical corrections. ([spacing](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=366s))
- Above roughly 100px, allow memorable increments of 5 or 10 unless the dimension must align with a column grid or gridded children. ([spacing](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=366s))
- Use progressively larger token jumps at larger scales instead of extending an 8px sequence linearly into imperceptible differences. ([spacing](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=366s))
- Define one radius per component tier: small controls may share one value, cards and sheets another, and pills a fully rounded value. Around 10px is a workable mobile-control starting point, not a universal mandate. ([consistency](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=168s))
- For nested rounded rectangles, start with `inner radius = outer radius − inset` so their arcs remain concentric; never reuse the parent radius blindly. Fails when the inset exceeds the outer radius, in which case choose a small inner radius optically. ([corners](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=68s))
- Keep nested pills and circles fully rounded; concentric-radius subtraction is unnecessary for those shapes. ([corners](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=68s))
- Check nested corners optically and adjust until the corner gap appears equal to the straight-edge gap; treat the formula as a starting point. ([corners](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=68s))
- Consider maximum corner smoothing for large, prominent rounded surfaces when the platform language supports it. Skip it on small controls where the difference and export complexity are negligible. ([corners](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=68s))
- Verify subtle geometry by overlaying treated and untreated shapes and inspecting where their outlines diverge. ([corners](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=68s))

## Buttons, actions, and navigation

- Give the primary or accent colour one stable semantic role across dialogs, usually the safe recommended action, and reserve a separate treatment for destructive actions. Tension: if destructive confirmation must be the default, use its dedicated destructive styling rather than inverting the learned primary-colour meaning. ([system](https://www.youtube.com/watch?v=ADaQuZS04Rc&t=206s))
- Render controls with the same role using identical geometry, radius, typography, border, and state treatment. When priority differs, preserve geometry and vary emphasis deliberately. ([consistency](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=168s))
- Maintain filled, outlined, and ghost variants in one button family; use the ghost variant for low-emphasis actions and navigation rows. Fails when a standalone ghost action lacks enough context or a persistent touch affordance to appear interactive. ([buttons](https://www.youtube.com/watch?v=EcbgbKtOELY&t=413s))
- Build sidebar and menu links as transparent button rows with consistent hit areas, padding, hover, focus, active, and disabled states. Keep links inside prose as ordinary accessible text links. ([buttons](https://www.youtube.com/watch?v=EcbgbKtOELY&t=413s))
- Present recommended and alternative actions at equal height and differentiate priority through fill weight. Fails when actions are truly equal or when one is destructive and needs semantic separation. ([buttons](https://www.youtube.com/watch?v=EcbgbKtOELY&t=413s))
- For short standalone labels, use roughly a 2:1 width-to-height ratio as a starting point. Treat it as a minimum rather than a target when the label itself is long. ([buttons](https://www.youtube.com/watch?v=EcbgbKtOELY&t=413s))
- Keep button height and padding unchanged when adding a leading icon; model icon presence as a variant of the same component. ([buttons](https://www.youtube.com/watch?v=EcbgbKtOELY&t=413s))
- Write commitment-button labels as explicit actions rather than vague nouns. ([pricing](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=271s))
- When moving a CTA into a more prominent position, reduce another emphasis signal—often by changing a solid button to an outline—and then rebalance the whole hierarchy. Fails when the action must remain the sole primary target or the outline loses accessible contrast. ([pricing](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=271s))
- Re-check hierarchy after every change to position, colour, size, or fill because prominence signals compound. ([pricing](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=271s))

## Chips, tags, and badges

- Keep chips visually subordinate to primary buttons by using neutral, tinted, or secondary fills. Use accent fill only when it clearly communicates selection and does not compete with the main CTA. ([chips](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=535s))
- Make the visible chip shorter than nearby buttons so it reads as a lightweight pill. Preserve a roughly 44px touch target on mobile even when the painted shape is shorter. ([chips](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=535s))
- Use asymmetric padding: set vertical padding to roughly one-half or one-quarter of horizontal padding. Loosen the ratio when icons or multiline content would become cramped. ([chips](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=535s))
- Build chips text-first with content-driven sizing: create the label, wrap it in auto layout, apply fill and radius, then tune padding. Never position text over a fixed rectangle. ([chips](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=535s))
- Audit chips for the two common failures: padding that hugs the label, and padding so generous that the chip becomes indistinguishable from a button. ([chips](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=535s))
- Use pill or strongly rounded geometry unless the host system intentionally uses rectilinear shapes. ([chips](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=535s))
- Reuse chips for compact filters, path segments, and optional low-commitment actions; never substitute them for primary conversion buttons. ([chips](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=535s))

## Icons

- Replace explanatory text with a familiar diagram or visual cue only when it communicates the same meaning more immediately. **Fails when:** An unfamiliar or ambiguous visual requires a label rather than relying on a delayed tooltip. ([scannable-ui](https://www.youtube.com/watch?v=neE6wOuBIP8&t=180s))
- Use conventional link styling and category chips to distinguish actionable content within a list. **Fails when:** Do not style passive content as an editable control. ([scannable-ui](https://www.youtube.com/watch?v=neE6wOuBIP8&t=180s))
- **Corroborated:** Choose one icon family as the product baseline so grid, stroke, fill, corners, and optical density agree. If coverage is incomplete, draw missing icons to that family’s specification instead of importing a foreign style. ([icons](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=214s)) ([icon-system](https://www.youtube.com/watch?v=Lp6ey4AyDzA&t=122s))
- Prefer a smaller coherent library when it covers common concepts; choose a broader family for icon-dense tools where constant custom drawing would become expensive. ([icon-system](https://www.youtube.com/watch?v=Lp6ey4AyDzA&t=122s))
- When sourcing from a marketplace, filter by category, stroke weight, and corner style before choosing individual glyphs. ([icons](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=214s))
- Use SVG assets so icons remain crisp, recolourable, and adaptable. ([icons](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=214s))
- Prefer conventional metaphors and the simplest glyph that communicates the concept; reserve illustration-grade detail for artwork rather than functional UI. ([icons](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=214s)) ([icon-system](https://www.youtube.com/watch?v=Lp6ey4AyDzA&t=122s))
- Scale detail to rendered size: reduce 16–24px icons to essential silhouettes or strokes, and permit more detail only when larger sizes can carry it. Do not add detail merely because space exists. ([icon-system](https://www.youtube.com/watch?v=Lp6ey4AyDzA&t=122s))
- Size inline icons deliberately to the adjacent text line height, then tighten the icon-label gap so they read as one unit. Do not accept library export dimensions unchanged. Fails when the icon is standalone content and should establish its own scale. ([buttons](https://www.youtube.com/watch?v=EcbgbKtOELY&t=413s)) ([icon-system](https://www.youtube.com/watch?v=Lp6ey4AyDzA&t=122s))
- Leave icons unlabelled only for near-universal metaphors. Add visible labels for ambiguous touch controls; on pointer interfaces, use tooltips only when the icon remains understandable after learning. ([icons](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=214s))
- Replace text-only utility actions with familiar icons when space is constrained, but retain words for primary, destructive, or unconventional actions. ([icons](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=214s))
- Add leading icons to repeated list or card items when shape improves scanning. Skip decorative glyphs when the distinguishing information is inherently textual. ([icons](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=214s))
- Permit different icon styles only when each is confined to a distinct spatial zone and function. Never render the same concept in different styles or mix styles within one cluster. ([icons](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=214s))
- Audit icons collectively for missing, inconsistent, oversized, or unexplained glyphs before tuning any one asset. ([icons](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=214s))

## Cards

- Anchor compact component content to shared edges before adding filler or hiding actions. **Fails when:** Do not force decorative or intentionally asymmetric compositions onto every edge. ([scannable-ui](https://www.youtube.com/watch?v=neE6wOuBIP8&t=0s))
- Reorganize the avatar, buttons and content to establish a usable alignment line when the existing anchors leave the composition unresolved. **Fails when:** Hide an action only when task priority justifies disclosure; alignment alone is not a reason to conceal it. ([scannable-ui](https://www.youtube.com/watch?v=neE6wOuBIP8&t=0s))
- Recheck row anchors after changing icon size or content height. **Fails when:** Do not invent meaningless subtext simply to fill the gap. ([scannable-ui](https://www.youtube.com/watch?v=neE6wOuBIP8&t=0s))
- Start with realistic content and the intended typeface before changing card layout; line lengths, heights, and media ratios depend on them. ([card-refit](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=193s))
- Treat readability as the floor, then perform a separate hierarchy pass. Fails for dense tables and admin matrices where uniform cross-row comparison is the purpose. ([card-hierarchy](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=270s))
- Cluster fields into semantic groups such as identity, terms, specifications, and dates before positioning them. Skip grouping when too few fields exist to form meaningful units. ([card-hierarchy](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=270s))
- Rank groups by how strongly they drive the user’s decision, then order and emphasise them accordingly. Re-rank for contexts where a normally secondary attribute becomes the primary filter. ([card-hierarchy](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=270s))
- Remove labels when formatting or a familiar icon already communicates the value. Retain them for adjacent values that look alike, unfamiliar metrics, ambiguous dates or prices, and required accessibility semantics. ([card-hierarchy](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=270s))
- Use opposing left- and right-aligned two-line stacks to compare two similarly weighted groups within a row. Collapse to a single column on narrow cards. ([card-hierarchy](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=270s))
- Compress homogeneous specifications into one icon-led row only when each concept has a well-established glyph. ([card-hierarchy](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=270s))
- Use generous, consistent internal padding across every card. Treat media consistently: inset it to the content margin or bleed it fully to the edge. ([dashboard](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=352s)) ([card-refit](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=193s))
- Define ordinary card boundaries with either a border or a contrasting fill, then apply that convention uniformly. Floating surfaces may need both a fill and hairline border against variable backgrounds. ([dashboard](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=352s))
- Treat theme-specific boundary advice as a convention, not a law: thin borders often work well in dark themes, while subtle fills often work well in light themes; accessibility and brand needs may reverse the choice. ([dashboard](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=352s))
- Use the system’s radius language on cards and their children. Prefer softened geometry for approachable consumer UI, but preserve deliberate hard geometry in dense tools or rectilinear brands. ([card-refit](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=193s))
- Make supporting copy clearly smaller than the title without dropping below a legible size, typically about 12–14px. ([card-refit](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=193s))
- Make an entire repeated card the accessible link when it has exactly one generic destination, rather than repeating a CTA button on every card. Keep a labelled button when the interaction is a specific action or the card has multiple actions. ([card-refit](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=193s))
- Signal whole-card links with a persistent cue on touch devices or a hover-revealed arrow on pointer devices; never rely on hover alone. ([card-refit](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=193s))
- Default media cards to image-above and opaque-text-below when imagery is uncontrolled. For curated imagery, an overlay may use an image covering roughly three-quarters of the card and a long, gradual lower-half scrim; abandon the overlay when the source image still compromises legibility. ([card-refit](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=193s))
- Use a low-opacity, oversized brand mark as background texture only on large empty fields where it cannot compete with foreground data. ([objects](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=167s))
- Design collection-backed cards for multiple instances from the first pass by including a pager or scroll affordance. Omit it when the entity is singular by system rule. ([objects](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=167s))

## Pricing and comparison cards

- Order standard subscription cards as plan name, audience description, price, billing clarification, CTA, then features. Adapt quote-based enterprise tiers where no headline price exists. ([pricing](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=271s))
- Give every tier a name and a one-line description of whom or what it serves before presenting price. ([pricing](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=271s))
- State the real recurring charge or billing condition directly beneath any discounted, introductory, annualised, or per-seat headline price. ([pricing](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=271s))
- Use check marks for included features and a clearly contrasting negative mark for exclusions. Do not use checks as decorative bullets in merely descriptive lists. ([pricing](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=271s))
- Separate offer and feature regions with one subtle tinted field when useful. Reject the treatment if contrast suffers or repeated tints turn the card into stripes. ([pricing](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=271s))

## Forms, inputs, and dialogs

- Give equivalent inputs identical height, radius, fill, border, typography, label treatment, and states; change appearance only to communicate a real semantic or priority difference. ([consistency](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=168s))
- Structure creation dialogs consistently: shortcuts or templates first, required fields in importance order, optional metadata later, and actions anchored at the bottom. ([system](https://www.youtube.com/watch?v=ADaQuZS04Rc&t=206s))
- Preserve the same modal skeleton across object types so primary fields and confirmation controls remain locatable by position. ([system](https://www.youtube.com/watch?v=ADaQuZS04Rc&t=206s))
- Group related form controls inside one meaningful container rather than styling each field as an independent card. Avoid card-inside-card nesting that weakens every boundary. ([dashboard](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=352s))

## Lists and tables

- Separate list rows with exactly one primary mechanism: whitespace, a divider, or a tinted or alternating background. Very wide, multi-column rows may justify both padding and a divider. ([dashboard](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=352s))
- Escalate separation with density: use whitespace for short sparse lists, dividers as rows multiply, and background fills when stronger row tracking is necessary. ([dashboard](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=352s))
- Include search, sortable columns, and at least one useful filter when a data table can grow beyond one screen. Omit that chrome from fixed, short summaries or comparison tables. ([dashboard](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=352s))

## Tabs and switchable views

- Use tabs for related destinations or representations within the current object rather than expanding top-level navigation. Move content to navigation when it is genuinely separate or the tab set grows beyond roughly five to seven items. ([dashboard](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=352s))
- Swap related views in place so page context, filters, scroll position, and the user’s mental model survive the transition. ([dashboard](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=352s))
- Use one tab component with horizontal and vertical orientations. Avoid horizontal variants with too many items and vertical variants whose long labels crush the panel width. ([tabs](https://www.youtube.com/watch?v=VPeTgU7la34&t=214s))
- Use a compact tabbed block for roughly three to five sibling panels when comparison is not required. Do not hide sequential, unrelated, or side-by-side-comparison content behind tabs. ([tabs](https://www.youtube.com/watch?v=VPeTgU7la34&t=214s))
- Default to manual switching. Add automatic advancement only with an explicit timer, progress indicator, and pause-on-interaction behaviour; passive carousel contexts may justify the extra state model. ([tabs](https://www.youtube.com/watch?v=VPeTgU7la34&t=214s))
- Design and hand off complete content for every panel, filtered state, accordion section, or carousel slide rather than duplicating placeholders after the first state. ([tabs](https://www.youtube.com/watch?v=VPeTgU7la34&t=214s))

## Component anatomy and implementation

- Separate placement from appearance for components that resize or morph: let an outer wrapper own page position and an inner surface own fill, radius, clipping, and animated dimensions. Skip the wrapper for static blocks, and keep it visually neutral. ([structure](https://www.youtube.com/watch?v=d4MF6pdAZNw&t=497s))
- Build interactive components outside-in: establish the wrapper, styled surface, logical groups, and then leaf content. This is optional when a library already fixes the containment model. ([structure](https://www.youtube.com/watch?v=d4MF6pdAZNw&t=497s))
- Wrap logical zones such as menu controls and navigation links in named sub-containers so alignment, spacing, visibility, and animation can operate on groups. Omit empty grouping layers around single elements. ([structure](https://www.youtube.com/watch?v=d4MF6pdAZNw&t=497s))
- Name containers for durable roles rather than current position or appearance. ([structure](https://www.youtube.com/watch?v=d4MF6pdAZNw&t=497s))
- Reuse structural conventions—wrapper type, grouping approach, naming, and state model—across related components so shared layout and motion rules remain portable. ([structure](https://www.youtube.com/watch?v=d4MF6pdAZNw&t=497s))
- Test entrance and morphing behaviour against representative surrounding content, contrast, and flow. An isolated component demo is sufficient only when isolation is the intended deliverable. ([structure](https://www.youtube.com/watch?v=d4MF6pdAZNw&t=497s))
- Keep motion local to state changes, transitions, and subtle reveals, but specify timing and easing precisely rather than accepting defaults. ([tabs](https://www.youtube.com/watch?v=VPeTgU7la34&t=214s))
- Design motion triggers for click, selection, and scroll as well as hover so touch users receive equivalent feedback. ([tabs](https://www.youtube.com/watch?v=VPeTgU7la34&t=214s))

## Host-product refitting

- Treat borrowed components as starting layouts: remap colour, typography, spacing, radii, states, and behaviour to the host system before shipping. ([refitting](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=0s))
- Audit inherited references at component scale before trusting their polish; templates and showcase work often contain decorative labels or actions that do not survive real use. ([objects](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=167s))
- Verify every action against what the underlying object can actually do. Preserve uncommon actions only when a valid configuration supports them. ([objects](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=167s))
- Rename fields to match the object’s real semantics rather than retaining labels from the source template. ([objects](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=167s))
- Reuse familiar real-world object layouts when they provide immediate recognition, then reskin and adapt them to the product. Reject borrowed constraints, brand residue, or imitation-level copying that conflicts with the host. ([objects](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=167s))
- Preserve a borrowed component wholesale only when it already belongs to the same system or the work is explicitly disposable prototyping; otherwise refit both appearance and interaction. ([refitting](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=0s))
