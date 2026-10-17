---
name: frame-product-strategy
description: "Load when an agent must translate user intent and business goals into product priorities, feature decisions, or engagement loops."
---

## Frame the problem

- **Name the intended user outcome first.** Write one sentence describing what the user is trying to accomplish, then reject priorities that do not materially advance it. For exploratory feeds or brand experiences, define a broader job instead of forcing a single action. ([intent](https://www.youtube.com/watch?v=HE4rLEQpiXY&t=0s))

- **Diagnose the constrained part of the funnel before proposing features.** Determine whether the limiting factor is acquisition, audience quality, activation, conversion, or retention; prioritize the bottleneck rather than improving an already-healthy stage. If reliable metrics do not exist, instrument the funnel or establish a baseline before claiming leverage. ([funnel](https://www.youtube.com/watch?v=5JxUJ1fuyO8&t=200s))

- **Ground the strategy in research-supported behavior.** Consolidate evidence into a realistic model of how target users experience the problem, emphasizing goals, frustrations, interests, and behaviors that affect decisions. Exclude decorative demographic details unless they materially change access, context, or behavior. Fails when the model is invented, represents another audience, or is never used to justify decisions. ([personas](https://www.youtube.com/watch?v=t7mpEDXzjCg&t=224s))

- **Frame emotional and interpersonal friction as product problems.** Identify anxiety, awkwardness, shame, uncertainty, or loss of control that remains after the functional task succeeds, then seek the smallest intervention that reduces it. Fails when a direct preference control would solve the issue better than additional information. ([social-friction](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=120s))

## Prioritize and triage features

- **Evaluate a feature by its net effort reduction.** Compare the work removed with the cost of inspecting, correcting, or undoing a bad result. Cut shortcuts whose recovery cost exceeds the manual path. Low-stakes suggestions can tolerate a lower hit rate when rejection costs only a glance. ([automation](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=170s))

- **Re-evaluate borrowed mechanics at the product’s actual stakes.** Account for transaction value, reversibility, privacy, safety, frequency, and social consequences; a pattern that works for a trivial commitment may fail for an expensive or sensitive one. ([automation](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=170s))

- **Expose consequences when the system creates them.** Show cost, commitment, affected parties, and other material effects at the moment an automated bundle or action is assembled—not only after the user proceeds. ([automation](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=170s))

- **Protect low-attention confirmation states.** Reserve the final stage before a consequential commitment for reviewing or correcting that commitment. Keep unrelated novelty actions elsewhere; allow only options that directly modify the pending transaction. ([automation](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=170s))

- **Reject unconsented downstream costs.** Do not make recipients, workers, moderators, or other third parties absorb ambiguity or extra work they neither requested nor can decline. Proceed only when they receive meaningful notice, consent, and a usable refusal path. ([automation](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=170s))

- **Attach decision support to a moment when it can change the decision.** Deliver relevant context after its subject is known and before the last practical opportunity to act. Fails when the information crowds out primary actions or safety-critical facts. ([social-friction](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=120s))

- **Make evidence interpretable.** Show the observation count beside aggregate ratings or confidence measures, and suppress results below a defensible sample threshold. Reuse a familiar scale only when the new dimension is genuinely ordinal; represent categories as categories rather than implying that one preference is universally better. ([social-friction](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=120s))

- **Treat service-relevant interaction style as matching data.** When users must spend time with a stranger, consider pace, formality, and conversational preference alongside competence. Fails when the trait is personal rather than task-relevant, becomes a punitive worker-performance score, or cannot affect the user’s choice or preparation. ([social-friction](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=120s))

## Personalize and recommend

- **Start with stated preferences, then learn from behavior.** Use brief onboarding signals to reduce cold-start uncertainty, but update recommendations from observed interactions and content-level attributes. Fails when data is sparse, inference quality is poor, consent is absent, or the signal is privacy-inappropriate. ([recommendations](https://www.youtube.com/watch?v=ixUq4HM4FNg&t=64s))

- **Explore beyond the user’s initial selections.** Test adjacent or emerging interests instead of freezing onboarding answers into permanent instructions, while providing an easy way to correct the system. Fails when a wrong recommendation has material consequences or users reasonably expect strict explicit control. ([recommendations](https://www.youtube.com/watch?v=ixUq4HM4FNg&t=64s))

- **Constrain convenience randomness to plausible outcomes.** Seed “surprise me,” shuffle, and auto-fill actions from known preferences or history when outputs require approval. **Tension:** use wider randomness when unfamiliar discovery is itself the value; over-personalization can trap users in what they already know. Cold-start users need another seed. ([automation](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=170s))

- **Reduce selection to one obvious continuation only when confidence is high.** Let the system choose the next item when recommendations are reliable and continuous consumption is the goal. Preserve browsing, comparison, and manual control when users need deliberate choice or diverse options. ([recommendations](https://www.youtube.com/watch?v=ixUq4HM4FNg&t=64s))

## Design content and creator ecosystems

- **Match content format to the intended cadence.** Support rapid discovery with plentiful, concise, self-contained units and immediate topic switching. **Tension:** prefer depth and continuity when understanding, evaluation, or task completion requires sustained attention; rapid formats fail with a thin catalogue. ([content-cadence](https://www.youtube.com/watch?v=ixUq4HM4FNg&t=167s))

- **Lower the creation threshold with a purpose-built tool.** Let non-experts produce publishable work quickly without specialist equipment, paid software, or professional editing skills. Make creation approachable enough to attract people who currently only consume. Fails when the platform cannot distribute, reward, or find an audience for the resulting work. ([creator-tools](https://www.youtube.com/watch?v=ixUq4HM4FNg&t=207s))

- **Connect consumption and creation into a reinforcing loop.** Expose relevant creation opportunities to consumers, then route published work back into discovery so each side supplies value to the other. Fails when the handoff is hidden, cumbersome, or lacks a credible benefit. ([creator-tools](https://www.youtube.com/watch?v=ixUq4HM4FNg&t=207s))

- **Give creators prompt, truthful evidence of distribution.** After publication, show real processing, reach, and engagement signals so contributors know what happened to their work. Never fabricate activity or overstate exposure to manufacture reassurance. ([creator-feedback](https://www.youtube.com/watch?v=ixUq4HM4FNg&t=241s))

- **Treat attainable reach as part of the creator experience.** Give new contributors a credible route to discovery and explain enough of the process for participation to feel worthwhile. Fails when exposure is so opaque or unpredictable that creators cannot form realistic expectations. ([creator-feedback](https://www.youtube.com/watch?v=ixUq4HM4FNg&t=241s))

- **Shorten audience feedback loops only where lightweight evaluation is valid.** Make items easy to sample when rapid response helps creators improve and viewers discover more. Fails when meaningful judgment requires depth, context, or sustained attention. ([creator-feedback](https://www.youtube.com/watch?v=ixUq4HM4FNg&t=241s))

## Build engagement and progression loops

- **Reward a small set of meaningful, repeatable behaviors.** Choose actions that represent real user progress, measure them reliably, and provide immediate feedback when completed. Fails when users can optimize the metric without achieving the intended outcome or when the behavior signal is untrustworthy or harmful. ([gamification-loop](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=105s)) ([gamification-concept](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=170s))

- **Make progress and remaining effort legible.** Divide multi-step work into meaningful milestones and show completed work, unfinished work, and the next attainable state. Fails when the path is misleading, excessively granular, irrelevant, or manufactured merely to create obligation. ([gamification-basics](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=25s))

- **Give rewards practical or intrinsic meaning.** Use recognition, useful benefits, status, recovery tools, or unlocks that advance a real user goal; preview the next reward when it can sustain long-term effort. Fails when rewards are arbitrary, too remote, too frequent, disconnected from the task, or impossible to fulfill consistently. ([gamification-basics](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=25s)) ([gamification-loop](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=105s)) ([progression](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=358s))

- **Choose currencies by motivational role.** Use one shared currency when several compatible activities should contribute to a single sense of progress. **Tension:** separate progression from spendable utility when status and consumable benefits require different economies. Fails when multiple currencies confuse users or a shared score rewards incompatible, superficial, or exploitative activity. ([gamification-basics](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=25s)) ([gamification-loop](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=105s)) ([progression](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=358s))

- **Use penalties only where users knowingly accept meaningful stakes.** Keep consequences immediate, bounded, and recoverable so an error does not end the broader progression loop. **Tension:** for fuzzy recall or early learning, favor retries and informative feedback over punishment. Penalties fail when errors arise from ambiguity, accessibility needs, or an expected learning curve. ([gamification-loop](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=105s)) ([re-entry](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=213s))

- **Make streaks serve the underlying behavior.** Set a short, meaningful action as the continuity threshold and use reminders only when daily cadence genuinely benefits the user. **Tension:** preserve real loss when the streak is the explicitly accepted core game, but favor compassionate recovery in low-obligation products where guilt accelerates churn. ([gamification-loop](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=105s)) ([re-entry](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=213s))

- **Design the broken streak before celebrating the active one.** Acknowledge lapses without shame and offer an immediate path back into the valuable activity rather than leaving a reset-to-zero dead end. Fails when loss is the intentional, clearly accepted stake of a competitive or accountability product. ([re-entry](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=213s))

- **Use badges for specific, sustained, beneficial behavior.** Define a clear threshold and reserve recognition for progress worth distinguishing. Fails when badges are vague, excessive, arbitrary, or reward activity that does not help the user. ([finance-game](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=170s))

- **Validate learning before rewarding completion.** Place a lightweight knowledge check after educational material and connect verified mastery to the main progression system. Fails when the check is trivial, misaligned with the lesson, excessively difficult, or encourages answer-gaming. ([progression](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=358s))

## Use social comparison carefully

- **Add public badges, ranks, or leaderboards only when comparison reinforces the desired behavior.** Confirm that the peer group is meaningful and participation respects privacy. Fails when competition discourages beginners, creates unhealthy pressure, or exposes sensitive activity. ([gamification-basics](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=25s))

- **Normalize rankings when circumstances differ materially.** Compare performance using a fair measure rather than raw totals when income, currency, opportunity, or starting position varies. Fails when the formula is opaque, inaccurate, gameable, or reveals sensitive information. ([finance-game](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=170s))

- **Make competitive states understandable without making them coercive.** Show how current performance maps to promotion, stability, or demotion only when those states support the product’s purpose. Fails when status anxiety undermines wellbeing or distorts sensitive behaviors such as saving. ([progression](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=358s))

## Design retention and re-entry

- **Design for the lapsed user’s return, not for punishing absence.** Restore orientation, surface a manageable next action, and remind users why returning is valuable. Use consequences only in products where users explicitly committed to accountability stakes. ([re-entry](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=213s))

- **Never hold a user’s existing content hostage to an engagement task.** Keep resume access available on the same surface as any quiz, upsell, or nudge. Require completion only for legitimate security, safety, age, or destructive-action safeguards. ([re-entry](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=213s))

- **Ship opinionated engagement mechanics with a visible local opt-out.** Let users disable nudges, mini-games, or interruptions where they encounter them; order temporary dismissal before permanent rejection when both are appropriate. Fails when opting out would make the core product incoherent—in that case, reconsider the mechanic itself. ([re-entry](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=213s))

## Apply gamification to consequential domains

- **Tie financial engagement to verified real-world progress.** Let users define concrete goals, reward genuine contributions, and calibrate milestones to difficulty rather than transaction theater. Fails when users can cycle funds or manipulate events without advancing the goal. ([finance-game](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=170s))

- **Represent several intentions as clearly labelled virtual allocations when one underlying balance funds them.** Make the planning abstraction explicit so users do not mistake goal buckets for separately protected accounts. ([finance-game](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=170s))

- **Pair motivation with capability-building.** Combine behavioral rewards with actionable analytics, relevant challenges, and education tied to the user’s current goals. Let users change analytical lens and time horizon only when the data supports those decisions. Fails when insights are too complex to act on, educational content is disconnected from current needs, or granular views imply certainty the data cannot support. ([finance-game](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=170s)) ([progression](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=358s))

## Deliver the strategy

- **Trace every recommendation from evidence to consequence.** State the user or business problem, constrained stage, proposed behavior change, supporting evidence, success measure, and principal failure mode. Use research-supported persona behavior—not cosmetic identity details—to explain why the choice should work. ([funnel](https://www.youtube.com/watch?v=5JxUJ1fuyO8&t=200s)) ([personas](https://www.youtube.com/watch?v=t7mpEDXzjCg&t=224s))

- **Present genuine conflicts as tensions to judge.** Preserve the contextual choice—control versus automation, familiarity versus discovery, stakes versus compassionate recovery, shared versus separate currencies, breadth versus depth, competition versus safety—rather than averaging incompatible advice into a universal rule. ([recommendations](https://www.youtube.com/watch?v=ixUq4HM4FNg&t=64s)) ([re-entry](https://www.youtube.com/watch?v=BUDipdbKK7Y&t=213s)) ([gamification-loop](https://www.youtube.com/watch?v=jSxxAFxjxbU&t=105s))
