---
name: adapt-platform-interfaces
description: "Load when an agent must make an interface conform to mobile, touch, desktop, or operating-system conventions."
---

## Establish the platform model

- Classify the target as mobile, touch, desktop, or a specific operating system before adapting it. Start from that platform’s native type scale, control sizes, spacing, chrome, and interaction model; treat brand styling as an overlay on a legible native baseline. **Fails when:** the product intentionally creates a cross-platform environment whose consistency outweighs native familiarity. ([mobile scale](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=92s)) ([macOS foundations](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=0s))

- Name one or two first-party or respected native apps that solve the same user moment, then inherit their invocation, placement, and dismissal conventions. Judge borrowed patterns against your product’s architecture, not their polish in the source app. **Repeated evidence.** ([macOS utility](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=23s)) ([macOS interactions](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=444s)) ([macOS search](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=331s))

- Derive entry, interaction, and exit from what the user is doing immediately before and after using the interface. Make a brief interruption behave like an overlay; make sustained work behave like a managed window or full screen. ([macOS utility](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=23s))

- Budget desktop adaptation across window structure, composition within each region, and platform-specific interaction details. Treat the last layer as required behavior, not optional polish. ([macOS foundations](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=0s))

- Test whether users would attempt an interaction instinctively. If they must consciously remember that it exists, expose or teach it; genuinely novel capabilities still require explicit instruction. ([macOS interactions](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=444s))

## Reduce desktop interfaces for mobile

- Keep mobile body text and spacing at least as generous as their desktop equivalents; begin near the platform’s default body size rather than shrinking the desktop scale. **Fails when:** deliberate high-density workspaces such as spreadsheets, terminals, trading tools, or code editors justify compactness. ([mobile scale](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=92s))

- Select exactly one desktop module as the subject of each phone screen. Move parallel lists, details, sidebars, and secondary panels into separate screens, tabs, or sheets. ([mobile scale](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=92s))

- Give each mobile section one primary movement axis: a vertical stack or a horizontally scrolling row. **Fails when:** a specialized task genuinely requires nested two-axis navigation. ([mobile content](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=133s))

- Build reduced mobile views from text, links, images, inputs, and cards. Use a card only when whitespace cannot communicate the group; avoid nested cards unless the hierarchy or interaction boundary requires them and sufficient width remains. ([mobile content](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=133s))

- Review phone layouts at physical size on a handset and beside mainstream apps from the same category. Do not trust an enlarged artboard or a density comparison with a fundamentally different product type. ([mobile scale](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=92s))

## Choose mobile navigation deliberately

- Reduce a desktop sidebar to three to five genuinely top-level destinations and place them in bottom navigation; prefer three or four. **Fails when:** many destinations have equal importance and collapsing them would bury real functionality. ([mobile navigation](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=20s))

- Convert an irreducible sidebar into a full-screen navigation home rather than forcing it into tabs or overflow. **Fails when:** users repeatedly switch among only two or three views, because the hub adds a hop to every switch. ([mobile navigation](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=20s))

- Balance a navigation home with recent items near the top and right-aligned counts or quick actions on rows. Reclaim the unused bottom edge for frequent search or capture. ([mobile navigation](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=20s))

- Keep primary destination tabs stable while replacing secondary chrome with actions relevant to the current page or focused object. Do not let contextual adaptation destroy the user’s spatial map. ([mobile navigation](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=20s)) ([focused mobile tasks](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=362s))

- Use a notification control and overflow menu only as an early top-bar baseline. Re-derive the final bar from the actual screen’s needs. ([mobile navigation](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=20s))

## Build usable bottom navigation

- Keep every touch target at least 44×44 px; reduce item count instead of shrinking targets. Distribute three to five tab cells broadly enough to enlarge their hit areas. **Fails when:** tablet-width distribution would push controls outside comfortable reach. **Repeated evidence.** ([mobile navigation](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=20s)) ([tab bars](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=25s))

- Label icons unless every glyph is a near-universal convention. Give both labels and inactive icons readable contrast rather than suppressing them with low opacity. **Fails when:** vertical space is severely constrained and every symbol is already unmistakable. ([tab bars](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=25s))

- Signal the active tab through at least two clear channels such as fill, weight, and color. Choose glyphs with usable filled and outline states, and reserve saturated brand color for the active state rather than the whole bar. ([tab bars](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=25s))

- Give every destination a coherent active state, including create or add screens. **Fails when:** the item fires a transient action and never represents a place the user can occupy. ([tab bars](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=25s))

- Replace a generic account glyph with the user’s avatar when available; provide a fallback and a separate active-state treatment because a photo cannot fill and unfill. ([tab bars](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=25s))

- Add floating, translucent, or blurred styling only after structure, contrast, and state are sound. Add a scrim or opacity floor when busy content passes beneath. ([tab bars](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=25s))

- Keep floating navigation visually separate from scrolling content when that treatment fits the product, but do not mistake fashionable chrome for a platform requirement. ([mobile navigation](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=20s))

## Resolve primary-action prominence as a tension

- Elevate a create or capture action above navigation only when it genuinely dominates most sessions; otherwise keep it aligned with the other controls. Visual prominence must follow actual frequency, not the action’s nominal importance. ([mobile navigation](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=20s)) ([tab bars](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=25s))

- Place the dominant outcome-driving action in the lower thumb zone and keep it visible through the flow. **Fails when:** system gestures, required media controls, or a higher-priority action already owns that region. ([mobile stories](https://www.youtube.com/watch?v=goWOAFqJHpA&t=90s))

- Adapt high-frequency control placement to one-handed reach and expected handedness. **Fails when:** the interface must serve both hands equally or span device sizes that make a fixed side unreliable. ([feed ergonomics](https://www.youtube.com/watch?v=ixUq4HM4FNg&t=291s))

- Keep infrequent escape controls such as dismiss near the conventional top position while moving frequently adjusted utilities lower. **Fails when:** platform conventions, accessibility, or safety areas require different placement. ([mobile stories](https://www.youtube.com/watch?v=goWOAFqJHpA&t=90s))

- Use the true native safe area instead of preserving browser-address-bar constraints in an app-only experience. **Fails when:** the same interface must also run inside a mobile browser or another environment with obstructive chrome. ([mobile stories](https://www.youtube.com/watch?v=goWOAFqJHpA&t=90s))

## Model gestures and direct manipulation

- Pair meaningful swipes with a visible control, contextual menu, or persistent affordance. If another control would overload a dense layout, retain a visible peek or teaching hint instead of silently making the gesture exclusive. **Repeated evidence.** ([gesture patterns](https://www.youtube.com/watch?v=14h1VnkQvIc&t=254s)) ([mobile gestures](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=311s))

- Use a gesture as a primary path only when it follows a strong platform convention or the product teaches it through onboarding, a hint, or an affordance. Do not assign an unconfirmed destructive action to a hidden gesture. ([mobile gestures](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=311s))

- Prefer learned gestures for frequent, reversible actions and visible controls for rare, precise, or destructive actions. **Tension:** remove a redundant visible control only when the gesture is truly conventional, discoverable, and accessible to the intended audience. ([gesture patterns](https://www.youtube.com/watch?v=14h1VnkQvIc&t=254s)) ([mobile stories](https://www.youtube.com/watch?v=goWOAFqJHpA&t=90s))

- Reuse the product’s established swipe direction and response for new gestures so learning transfers. Keep this skill focused on spatial semantics; leave easing and timing implementation to motion guidance. ([gesture patterns](https://www.youtube.com/watch?v=14h1VnkQvIc&t=254s))

- Make reversible navigation track the finger continuously so users can preview and abort it. Move the underlying parent screen in the opposing direction to communicate depth. **Fails when:** the action is irreversible, has no meaningful intermediate state, or connects peer/root screens where depth would misrepresent the hierarchy. ([mobile gestures](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=311s))

- Offer swipe-up search only on primary screens where search is frequent and the gesture borrows strong platform recognition. **Fails when:** vertical scrolling, pull-to-refresh, or another established behavior already owns the gesture. ([mobile gestures](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=311s))

- Treat long press as mobile right-click: use it for secondary actions on an object, never as the only path to a primary action. ([mobile gestures](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=311s))

- Anchor a long-press menu to the pressed object, dim competing context, and identify the target with a modest lifted state. **Fails when:** a dense grid leaves too little room or would move the object beneath the finger or off-screen. ([mobile gestures](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=311s))

- Turn a media item’s long-press state into a useful live preview when its content rewards inspection. **Fails when:** the item has no meaningful visual payload or the preview adds latency without information. ([mobile gestures](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=311s))

- Give a dominant repeat action a large direct gesture target with minimal thumb travel. **Fails when:** the target conflicts with important controls or the task requires deliberate, precise navigation. ([feed ergonomics](https://www.youtube.com/watch?v=ixUq4HM4FNg&t=291s))

## Make sheets and committal controls safe

- Let an edge-presented surface dismiss toward the edge it entered from, and always provide a visible close control. For a scrolling bottom sheet, begin dismissal only after its inner scroll reaches the top. ([gesture patterns](https://www.youtube.com/watch?v=14h1VnkQvIc&t=254s))

- Communicate a modal sheet as a layer above the current context by making the background recede and restoring it exactly on dismissal. **Fails when:** the surface is persistent or non-modal and the background remains interactive, or the previous screen genuinely leaves the navigation stack. ([gesture patterns](https://www.youtube.com/watch?v=14h1VnkQvIc&t=254s)) ([mobile gestures](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=311s))

- Match the background response to the incoming layer: opposing horizontal displacement for hierarchical navigation and depth recession for vertical overlays. Do not make navigation and modality share a misleading spatial model. ([mobile gestures](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=311s))

- Use slide-to-confirm for irreversible or costly actions only when the added friction is justified. Require the handle to traverse the full track and reset it if released early. **Fails when:** the action is routine, reversible, or frequent, or the user cannot perform the drag; provide an accessible tap alternative where necessary. ([gesture patterns](https://www.youtube.com/watch?v=14h1VnkQvIc&t=254s))

## Adapt chrome to focused mobile tasks

- Replace global navigation with object-specific actions when entering an editor, detail view, or focused task. Provide an obvious back or dismiss path so users are not stranded from top-level destinations. ([focused mobile tasks](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=362s))

- Derive contextual actions from the object currently in focus, while preserving expected global actions such as search, new item, or account access somewhere reachable. ([focused mobile tasks](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=362s))

- Reduce a single-decision modal step to accept and cancel. **Fails when:** preview, filtering, search, or another secondary operation is genuinely necessary to make the choice. ([focused mobile tasks](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=362s))

- Prefer the top region for contextual toolbars when the bottom region means global navigation. **Tension:** move reach-critical actions lower on tall phones rather than preserving regional semantics at the cost of usability. ([focused mobile tasks](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=362s)) ([mobile stories](https://www.youtube.com/watch?v=goWOAFqJHpA&t=90s))

- Show chrome replacement as a continuous mode change so users understand that the action set changed rather than the interface resetting. Specify the state relationship here, not motion timing or choreography. ([focused mobile tasks](https://www.youtube.com/watch?v=Gfsd8NNuD9g&t=362s))

## Control sequential media and feeds

- Combine controls when entering one flow predictably performs the needed secondary state change, such as pausing media while sharing. **Fails when:** users need the secondary action independently or entering the new flow should not interrupt playback. ([mobile stories](https://www.youtube.com/watch?v=goWOAFqJHpA&t=90s))

- Remove visible playback controls only when the replacement gesture is established, discoverable, accessible, and free of tap conflicts. Otherwise keep explicit controls. ([mobile stories](https://www.youtube.com/watch?v=goWOAFqJHpA&t=90s))

- Use snapping or autoplay to remove needless steps from low-decision sequential content. **Fails when:** users need time, consent, or control before continuation, or the product should encourage intentional bounded use. ([feed ergonomics](https://www.youtube.com/watch?v=ixUq4HM4FNg&t=291s))

- Evaluate low-friction interaction, short-form content, and personalization as one reinforcing engagement system. Do not optimize that system when the product goal is deliberate, finite use. ([feed ergonomics](https://www.youtube.com/watch?v=ixUq4HM4FNg&t=291s))

## Build native macOS window shells

- Classify the surface as content-presentation or content-hosting before laying it out. Shape hosting interfaces around unpredictable user content and volume; tightly compose only fixed, authored surfaces such as marketing, onboarding, or documentation. ([macOS layout](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=136s))

- Default a multi-section macOS app to a global top bar, left navigation sidebar, and remaining content area. Remove the sidebar below roughly three top-level destinations. **Fails when:** near-term growth will require those destinations and retrofitting the shell would cause a disruptive relayout. ([macOS layout](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=136s))

- Preserve roughly the top 50 px as a usable window-drag region. Integrate traffic-light controls into the toolbar or sidebar rhythm instead of leaving a disconnected blank strip. ([macOS layout](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=136s))

- Hide filters, sorting, bulk actions, and view controls until content exists. **Fails when:** absence would conceal important capability or later appearance would cause a disruptive layout shift; reserve a stable slot or show a disabled state instead. ([macOS layout](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=136s))

- Make an empty state one direct prompt toward the action that ends it. Show only scannable item summaries in browsing views and defer full metadata until selection; keep attributes visible when they are the primary basis for choosing. ([macOS layout](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=136s))

- Establish the minimum usable controls before adding color, shadows, gradients, blur, or other effects. **Fails when:** styling is itself the product’s value, as in a creative tool, theme, or brand-led environment. ([macOS layout](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=136s))

- Keep a focused app scoped to one job, and reject additions that would force otherwise unnecessary navigation. ([macOS layout](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=136s))

## Design keyboard-first macOS utilities

- Make a global shortcut the primary entry point for frequent capture or lookup utilities, and dismiss the surface when the task completes. **Fails when:** users deliberately remain in the app for sustained work. ([macOS utility](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=23s))

- Remove traffic lights and persistence-oriented chrome from transient shortcut-invoked overlays. **Fails when:** users may resize, park, manage, or return to the window later. ([macOS utility](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=23s))

- Limit a transient utility to the input or drop target and the actions needed to complete or cancel one task. Move browsing, comparison, and editing into a fuller window. ([macOS utility](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=23s))

- Display keyboard equivalents beside visible actions so ordinary pointer use teaches the faster path. ([macOS utility](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=23s))

- Anchor transient panels to a screen edge or let users reposition them so they do not obscure the work being referenced. ([macOS utility](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=23s))

- Use translucent system material for floating panels when it preserves context and reinforces their layer. **Fails when:** precise color judgment, dense reading, or a busy background would reduce legibility. ([macOS utility](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=23s))

- Confirm successful submit-and-dismiss actions through the panel’s exit state rather than another dialog. **Fails when:** the operation is destructive or failure-prone and the success treatment could misreport its outcome. ([macOS utility](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=23s))

- Use optimistic save-and-dismiss only for high-success, recoverable operations, and implement visible failure, retry, and recovery paths. Do not use it for payments, permanent deletion, publishing, or actions whose assumed success drives further decisions. ([macOS utility](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=23s))

## Implement native search patterns

- Keep search permanently visible at the top level of a browsable macOS collection. **Fails when:** the collection is small enough to scan immediately. ([macOS search](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=331s))

- Preserve the product’s navigation model when choosing search: filter inline or use an attached overlay for single-screen tools; use a command palette when jumping among screens, documents, or workspaces is the point. ([macOS search](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=331s))

- Size semantic-search fields for descriptive, multi-clause phrases and set expectations accordingly. **Fails when:** the engine only matches filenames or metadata and cannot honor natural-language queries. ([macOS search](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=331s))

- For visual libraries, show a small ranked set of strong matches per item in a secondary panel. **Fails when:** the task requires exhaustive review and truncation could hide consequential matches. ([macOS search](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=331s))

- Distinguish filtered results from default browsing whenever they reuse the same visual layout. Omit extra markers only when search opens an unmistakably different surface. ([macOS search](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=331s))

- Give in-place search four affordances: result count, one-click clear, persistent query echo, and an explicit return to unfiltered browsing. Keep count and clear with the input; place the query state and back affordance with the content. ([macOS search](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=331s))

## Support drag, drop, sharing, and item actions

- Make every portable content item a drag source and support both drag-in and drag-out; prioritize drag-out because repeated export friction compounds. **Fails when:** the item is only a reference, permissioned record, or live query that requires an explicit format-aware export. ([macOS interactions](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=444s))

- Accept drops directly on the primary capture surface instead of requiring a separate import screen. ([macOS interactions](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=444s))

- Offer the platform share affordance alongside dragging: use drag when both windows are reachable and share when the destination is hidden or backgrounded. ([macOS interactions](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=444s))

- Pin frequent item actions such as copy, locate, and delete inside the detail or preview panel. **Fails when:** the action set is long or varies substantially by item type; move the remainder into overflow or a context menu. ([macOS interactions](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=444s))

- Reuse one floating-overlay treatment for persistent search and action clusters so “available above content” has one visual meaning. ([macOS interactions](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=444s))

## Teach invisible desktop behavior

- Show first-run onboarding when the app’s primary interface is invisible until a shortcut summons it. Skip it when the launched window already makes the app self-evident. ([macOS onboarding](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=495s))

- Ask users to perform the critical shortcut or gesture to complete onboarding so instruction becomes rehearsal. Always provide an escape hatch for shortcut conflicts, missing permissions, or unavailable hardware. ([macOS onboarding](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=495s))

- Keep a permanent shortcut reference reachable without already knowing a shortcut, such as through visible settings. A separate reference sheet is unnecessary when persistent chrome already lists every shortcut clearly. ([macOS onboarding](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=495s))

- Match onboarding depth to product complexity: use one focused modal for a single-purpose utility and a broader sequence only for genuinely multi-mode workflows. ([macOS onboarding](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=495s))

- Use responsive feedback to make first-run teaching feel crafted, but never delay the user’s first success or replay ceremonial onboarding on every launch. ([macOS onboarding](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=495s))

## Configure transient utilities proportionally

- Collect a handful of low-frequency options in a compact settings popover. Move to a preferences window when the settings require scrolling, tabs, or substantial explanation. ([macOS onboarding](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=495s))

- Let users choose which screen edge hosts a sliding panel because monitors, dock placement, and handedness vary. ([macOS onboarding](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=495s))

- Offer system-follow, light, and dark appearance modes for overlays shown above arbitrary content. **Tension:** omit manual overrides when the product should behave as an invisible native extension and divergence from system appearance would look broken. ([macOS onboarding](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=495s))
