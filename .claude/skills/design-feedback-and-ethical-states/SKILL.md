---
name: design-feedback-and-ethical-states
description: "Load when an agent must specify how controls and interruptions communicate state, outcomes, trust, and user agency."
---

## Working method

- Start with a state inventory at every scale, from screens and overlays down to buttons, fields, rows, cells, and icons. Specify populated, empty, loading, success, warning, error, default, hover, pressed, focus, selected, disabled, and overflow states wherever applicable. **Multi-source. Fails when:** The surface is genuinely static and has no interaction or data dependency. ([State design](https://www.youtube.com/watch?v=ADaQuZS04Rc&t=60s)) ([Component states](https://www.youtube.com/watch?v=EcbgbKtOELY&t=449s)) ([Hidden UI](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=299s))

- Audit each entry point and interaction from before, through, and after the action. Add a state wherever the user would otherwise see no change, and accept the design only when users remain informed and in control. **Multi-source.** ([State design](https://www.youtube.com/watch?v=ADaQuZS04Rc&t=60s)) ([Component states](https://www.youtube.com/watch?v=EcbgbKtOELY&t=449s))

- Treat transient control feedback and final outcome feedback as separate layers. Hover or press confirms input; success or failure confirms the result. ([Outcome feedback](https://www.youtube.com/watch?v=EcbgbKtOELY&t=487s))

- Specify triggers, priority, displacement, stacking, and dismissal for hidden states independently from their visual styling. Apply this accounting even to small repeated elements. ([Hidden UI](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=299s))

- Design rare states such as first-run education, announcements, empty views, and public errors; their low frequency does not reduce their importance. ([Hidden UI](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=299s))

- Stay within state behavior: specify local feedback, interruptions, overlays, and recovery requirements. Record deep, multi-step, linkable, or shareable work as a routing handoff instead of designing flow topology here. ([Hidden UI](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=299s))

- Describe motion only by purpose, urgency, and restraint. Do not produce keyframes, easing specifications, or animation assets. **Fails when:** The implementation task explicitly includes animation production. ([Dashboard interaction](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=444s)) ([Tooltip timing](https://www.youtube.com/watch?v=ld1zhQMXxXU&t=259s))

## Controls and affordances

- Give every interactive element distinct default, hover, pressed, focus, selected, and disabled treatments as relevant. Make press feedback immediate and lighter than the resulting work. **Multi-source. Fails when:** Hover does not exist on the target device; strengthen pressed feedback and hit targets instead. Avoid a pressed effect that is slow, heavy, or glitch-like during an instant transition. ([Visual semantics](https://www.youtube.com/watch?v=EcbgbKtOELY&t=0s)) ([Button feedback](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=332s)) ([Component states](https://www.youtube.com/watch?v=EcbgbKtOELY&t=449s))

- Assign separate visual channels to separate meanings: enclosure for grouping, fill or elevation for selection, contrast for availability, and a ring or border for focus. Do not reuse one treatment for competing states. ([Visual semantics](https://www.youtube.com/watch?v=EcbgbKtOELY&t=0s))

- Enclose related controls in a shared boundary, and give exactly one item in a mutually exclusive set the selected treatment. **Fails when:** Everything is boxed, containers nest excessively, multiple items appear selected, or selection looks identical to hover or focus. ([Visual semantics](https://www.youtube.com/watch?v=EcbgbKtOELY&t=0s))

- Show temporary unavailability by reducing emphasis without sacrificing legibility. Keep disabled controls distinguishable from ordinary secondary text, noninteractive, and programmatically disabled. Explain the restriction when its reason or remedy is not apparent. **Fails when:** Reduced contrast becomes inaccessible or a permission gate needs a specific diagnosis and recovery path. ([Visual semantics](https://www.youtube.com/watch?v=EcbgbKtOELY&t=0s))

- Show keyboard and pointer focus clearly on every field and custom control; never remove the focus indicator without an equally visible replacement. ([Component states](https://www.youtube.com/watch?v=EcbgbKtOELY&t=449s))

- Make continuous gestures track the user’s input directly, including scroll, swipe, drag, and pull-to-refresh feedback. **Fails when:** Responses spread to unrelated elements, introduce lag, or become visual noise. ([Component states](https://www.youtube.com/watch?v=EcbgbKtOELY&t=449s))

- Keep repeated product motion short and functional: clarify state, preserve continuity, or reveal information. Reserve expressive flourishes for persuasion, onboarding, or other infrequent moments. **Fails when:** Decorative feedback competes with data or becomes tedious through repetition. ([Dashboard interaction](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=444s))

## Loading, completion, and failure

- Scale feedback to latency. Use immediate pressed or disabled feedback for sub-second work, then show persistent progress when the wait becomes perceptible. **Tension:** Never leave unresolved data regions looking blank or broken, but avoid flashing a spinner for work that finishes almost instantly. ([Button feedback](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=332s)) ([Component states](https://www.youtube.com/watch?v=EcbgbKtOELY&t=449s))

- Prevent duplicate submissions while an operation is running. Preserve a visible cancel, back-out, or safe escape for long-running work. **Fails when:** Disabling the only control traps the user in an operation they may legitimately stop. ([Button feedback](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=332s))

- Resolve every asynchronous indicator into an explicit success or error state; never let progress simply disappear. Use positive confirmation whenever the result is not already unmistakable. **Multi-source.** ([State design](https://www.youtube.com/watch?v=ADaQuZS04Rc&t=60s)) ([Component states](https://www.youtube.com/watch?v=EcbgbKtOELY&t=449s))

- Confirm low-stakes invisible outcomes such as copying, background saving, subscribing, or adding to a collection with a lightweight transient label, chip, or toast near the triggering control. **Fails when:** The result is already plainly visible, the event is global, or the consequence requires persistent acknowledgement. ([Outcome feedback](https://www.youtube.com/watch?v=EcbgbKtOELY&t=487s))

- Update downstream destinations as well as the triggering control: change counts or badges where the saved, moved, or added item now lives. Clear attention markers after the user visits the destination. **Fails when:** The action has no downstream destination or a persistent badge would become meaningless noise. ([Button feedback](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=332s))

- Deliver long-running job outcomes through a persistent status surface or notification that survives navigation. **Fails when:** The action completes immediately while the user is still watching its inline state. ([State design](https://www.youtube.com/watch?v=ADaQuZS04Rc&t=60s))

- Use optimistic updates for frequent, reversible, low-stakes actions that almost always succeed. Restore the previous state and explain the failure if the request fails. **Fails when:** The action is irreversible, financially consequential, validation-heavy, failure-prone, or slow enough to leave a long-lived false state. ([Dashboard interaction](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=444s))

- Optimize perceived responsiveness by closing the gap between input and visible acknowledgement, while preserving truthful state. **Fails when:** Faster-looking feedback would conceal materially slow or incomplete work. ([Dashboard interaction](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=444s))

## Empty, warning, and validation states

- Build first-run empty states from a visual anchor, a short explanation of why the space is empty, and a primary action that can populate it. ([State design](https://www.youtube.com/watch?v=ADaQuZS04Rc&t=60s))

- Pair field errors with a visible field treatment and adjacent text that names the problem and how to correct it. Never rely on color alone. ([Component states](https://www.youtube.com/watch?v=EcbgbKtOELY&t=449s))

- Distinguish advisory warnings from blocking errors, and let valid submissions proceed through warnings. **Fails when:** Every rule is hard-blocking and an advisory tier would only create uncertainty. ([Component states](https://www.youtube.com/watch?v=EcbgbKtOELY&t=449s))

- Leave naming fields empty when meaningful user-authored names are required, then validate at the point the user tries to leave the object. **Fails when:** Naming every high-volume object creates disproportionate work, or the user is abandoning or deleting the draft rather than continuing. ([Reversible constraints](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=142s))

## Tooltips and hidden controls

- Make visual styling carry availability, grouping, and selection before adding explanatory text. Use words for arbitrary rules, provenance, pricing, consequences, and other meanings styling cannot communicate. ([Visual semantics](https://www.youtube.com/watch?v=EcbgbKtOELY&t=0s))

- Use tooltips to name visible icon-only affordances or clarify compact, ambiguous labels—not to rescue an interaction that does not look interactive. Rewrite unclear persistent labels when space permits. **Multi-source. Fails when:** Essential information must work on touch, keyboard, or without hover. ([Visual semantics](https://www.youtube.com/watch?v=EcbgbKtOELY&t=0s)) ([Hidden UI](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=299s))

- Delay pointer tooltips long enough to filter passing hovers—about one second—then dismiss them promptly when the pointer leaves. Preserve equivalent access through focus where applicable. ([Tooltip timing](https://www.youtube.com/watch?v=ld1zhQMXxXU&t=259s))

- Reveal space-constrained row or cell actions on hover only when users can still discover and access them by keyboard and touch. **Fails when:** The interface is touch-primary or the action is destructive, important, or too hidden to be trusted. ([Hidden UI](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=299s))

- Mark hidden per-item content with a small persistent indicator that expands on interaction. Promote it to a visible field or column when it becomes common. **Fails when:** Most items carry the marker and it becomes background noise. ([Hidden UI](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=299s))

## Data inspection

- Give chart marks an inspectable hover, focus, or tap state that reveals exact values omitted from the static view. Provide a non-hover equivalent on touch devices. ([Dashboard interaction](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=444s))

- Show both the raw value and a meaningful comparison such as change over time or share of total. **Fails when:** No honest baseline or denominator exists. ([Dashboard interaction](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=444s))

- Isolate a hovered mark by dimming competing marks while retaining enough context for comparison. **Fails when:** The chart contains only a few marks and dimming creates more distraction than clarity. ([Dashboard interaction](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=444s))

## Humane microcopy

- Write errors, denials, and shortfalls in neutral, factual language. Name what happened, its effect, and the next available action; do not explain company motives in place of a fix. ([Coercive gates](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=70s)) ([Failure framing](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=99s))

- Read critical copy aloud as though spoken to an already-irritated user. Rewrite anything that can sound accusatory, sarcastic, passive-aggressive, or rebuking. **Multi-source.** ([Humane prompts](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=34s)) ([Failure framing](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=99s))

- Pair behavioral statistics with neutral context or comparison rather than presenting morally loaded numbers bare. **Fails when:** The user explicitly opted into uncompromising numerical accountability and contextual softening would undermine it. ([Humane prompts](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=34s))

- Express a recoverable goal gap in the smallest honest unit of action the user can take now. **Fails when:** The gap cannot realistically be closed; offer an honest reset or reframing instead. ([Failure framing](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=99s))

- Surface failure or shortfall when the user seeks it, or pair an unavoidable alert with a useful next action. Do not volunteer judgment through unsolicited notifications. **Fails when:** Medication, security, deadlines, or another time-critical concern requires interruption. ([Failure framing](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=99s))

- Keep goal editing in settings or another user-initiated configuration surface. Do not place “lower your goal” beside a shortfall message. **Fails when:** The user deliberately opened settings to adjust the goal. ([Failure framing](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=99s))

## Interruptions and nudges

- Make wellbeing and self-control interventions opt-in, and trigger them only for users who chose the relevant limit. **Fails when:** A lawful disclosure or genuine safety intervention cannot depend on consent. ([Humane prompts](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=34s))

- Trigger behavioral nudges from the behavior they describe: use accumulated session time for duration problems, place thresholds in the tail of observed usage, and interrupt at a task boundary. **Fails when:** Telemetry cannot support an honest threshold, long sessions are the intended use, or urgent harm outweighs interruption cost. ([Humane prompts](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=34s)) ([Nudge timing](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=54s))

- Give a nudge a concrete, user-serving alternative as its primary action instead of merely telling the user to stop. **Fails when:** The alternative is a disguised upsell or benefits the product more than the user. ([Nudge timing](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=54s))

- Default nudge copy to respectful neutrality. **Tension:** A teasing second-person voice may soften a low-stakes, optional consumer prompt when it matches an established voice; never use it for billing, security, data loss, addiction, compulsive spending, or vulnerable users. ([Nudge timing](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=54s)) ([Failure framing](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=99s))

- Offer a free, permanent way to dismiss product-initiated recurring interruptions; never sell relief from an interruption the product created. **Fails when:** Advertising is the explicit contract of a clearly ad-supported free tier. ([Humane prompts](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=34s))

- Put escape, dismissal, and disable instructions inside any blocking modal or constrained state. Make opt-in strict modes visibly reversible there. **Fails when:** Safety, compliance, or data-integrity requirements make self-service reversal inappropriate. ([Reversible constraints](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=142s))

- Preserve baseline usability regardless of whether the product voice is playful, strict, hostile, or minimal. Tone never excuses a hidden exit or missing explanation. ([Reversible constraints](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=142s))

## Permissions and access gates

- Let users complete core tasks on the platform, browser, or device they arrived with; degrade unsupported features gracefully instead of denying entry. **Fails when:** A genuine capability or security requirement is missing; explain it specifically and provide the closest viable fallback. ([Coercive gates](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=70s))

- Judge alternatives by whether they restore the original goal at comparable cost in time, effort, dignity, and money. Do not present a deliberately worse path as consent. **Fails when:** The options genuinely serve different preferences at comparable cost. ([Coercive gates](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=70s))

- Keep timed ads and conversion demands out of the doorway to functionality users already possess. **Fails when:** An optional premium extra has an obvious free alternative and the rewarded-ad exchange is explicit. ([Coercive gates](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=70s))

- Let users finish short, urgent real-world utility tasks before requesting payment or registration. Do not stack both demands in one blocking moment. **Fails when:** The gated material is itself the commercial product, such as a paid course, original reporting, or a professional tool. ([Access walls](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=236s))

- Treat widespread conversion patterns as hypotheses, not validation. Determine whether users accept the pattern or merely endure it before importing it from another category. ([Access walls](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=236s))

- Require explicit owner confirmation before granting control of physical devices; do not treat proximity as authorization. **Fails when:** The owner deliberately opened an ephemeral, low-stakes shared context such as a party speaker queue or conference display. ([Device permissions](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=257s))

- Scale permission strength to the physical, privacy, or financial consequence of the capability. Do not place lights, locks, and similarly unequal risks behind one flat access tier. ([Device permissions](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=257s))

- Default risky capabilities off and require explicit opt-in; buried settings discovered after harm are not meaningful protection. ([Device permissions](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=257s))

- Attribute unexpected shared-state changes to the person, automation, or integration responsible, and provide an immediate revoke path. **Fails when:** The event comes from a routine automation the user authored and repeated attribution would create noise. ([Device permissions](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=257s))

## Failure personality

- Keep active-work failures plain, diagnostic, and recovery-led. Reserve playful personality for low-stakes surfaces such as 404s, empty states, and nonblocking loading moments. **Fails when:** Personality distracts from lost work, failed payment, authentication, or another consequential problem. ([404 personality](https://www.youtube.com/watch?v=SfX43uIubj4&t=355s))

- Give a public 404 a custom visual or small optional interaction in the product’s established voice, while keeping an obvious route back visible immediately. Increase interactivity only to a level the team can maintain. **Fails when:** The playful element becomes the only exit or delays recovery. ([404 personality](https://www.youtube.com/watch?v=SfX43uIubj4&t=355s))

- Use personality as an additive detail, never as compensation for an incomplete primary experience. **Fails when:** Delight work displaces essential state, accessibility, or recovery design. ([404 personality](https://www.youtube.com/watch?v=SfX43uIubj4&t=355s))

## Dark-pattern audit

- Name the emotion a gate or interruption is likely to produce. Redesign the structure—not merely the copy—when the honest answer is anger, humiliation, coercion, or entrapment. **Fails when:** Necessary security, safety, or destructive-action friction is irritating but proportionate and protective. ([Access walls](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=236s))

- Prototype questionable gates against a representative high-stakes moment and observe whether the design immediately feels hostile. Reject the pattern when its business case depends on exploiting urgency or distress. **Fails when:** The chosen scenario is an unrepresentative edge case that would over-reject reasonable friction. ([Coercive gates](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=70s))

- Audit every blocking state for a truthful diagnosis, a viable recovery path, comparable alternatives, reversible consent, proportional permissions, and a discoverable exit. Treat any missing item as a trust and agency defect. ([Coercive gates](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=70s))
