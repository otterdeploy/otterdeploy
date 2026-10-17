---
name: design-ai-product-experiences
description: "Load when an agent must design controls, transparency, editing, memory, history, waiting, or trust patterns specific to AI products."
---

## Design workflow

- Start with the user’s intended AI action, then design the composer, preflight checks, waiting state, result, revision path, history, and trust signals as one continuous experience. Keep controls near the object or action they affect. ([composer](https://www.youtube.com/watch?v=If7iCPDy2vk&t=21s))
- Before submission, make it clear what the system will use, what it will do, and what the action may cost. Treat attachments, context, mode, settings, and cost as a preflight check rather than post-submit explanation. ([composer](https://www.youtube.com/watch?v=If7iCPDy2vk&t=21s))
- Preserve user control after generation: retain valuable outputs, expose persistent memory, support local revisions, and show evidence or uncertainty where those signals are real. ([history](https://www.youtube.com/watch?v=If7iCPDy2vk&t=111s))

## Compose prompts and context

- Make the prompt composer the dominant above-the-fold element when one prompt can demonstrate the product’s core value. Let secondary content visually recede. **Fails when:** useful output requires setup, connected data, or account context; an empty input then feels like work rather than an invitation. ([composer](https://www.youtube.com/watch?v=If7iCPDy2vk&t=21s))
- Treat the composer as the control panel for everything needed before sending: attachments, explicit context, modes, integrations, advanced settings, and cost. Keep its resting state simple through progressive disclosure. **Fails when:** the accumulated controls make the composer illegible; move infrequent or structured options into a nearby popover or panel. ([composer](https://www.youtube.com/watch?v=If7iCPDy2vk&t=21s))
- Default to a text field and clear send affordance, then place specialist controls behind one discoverable advanced-mode trigger. ([composer](https://www.youtube.com/watch?v=If7iCPDy2vk&t=21s))
- Render attachments as recognizable preview tiles—such as image thumbnails or document cards—instead of filename-only rows. ([composer](https://www.youtube.com/watch?v=If7iCPDy2vk&t=21s))
- Collapse large pasted content into a compact, labelled, expandable block so it does not overwhelm the composer or conversation. **Fails when:** the paste is short enough that the user is likely to edit it inline. ([composer](https://www.youtube.com/watch?v=If7iCPDy2vk&t=21s))
- Show explicit context references as persistent pills in or above the composer so users can verify and remove what the system will inspect. ([composer](https://www.youtube.com/watch?v=If7iCPDy2vk&t=21s))
- Offer relevant source connections—drives, repositories, design files, or internal systems—while the user is assembling context, not only in account settings. ([composer](https://www.youtube.com/watch?v=If7iCPDy2vk&t=21s))
- Expose a small set of task modes as composer chips when mode selection materially changes output and helps users discover supported jobs. **Fails when:** the product has one clear purpose; mode selection would add a needless decision. ([composer](https://www.youtube.com/watch?v=If7iCPDy2vk&t=21s))
- Show estimated credits, tokens, or monetary cost beside the action before submission when users can change scope or mode to control that cost. **Fails when:** usage is flat-rate or unmetered; an unactionable cost signal creates anxiety. ([composer](https://www.youtube.com/watch?v=If7iCPDy2vk&t=21s))

## Demonstrate the product

- Let visitors use the working interface immediately when a first interaction is self-explanatory, meaningful, and available before signup. The product experience can serve as the marketing demonstration. **Fails when:** visitors need positioning, pricing, safety, or trust context before they can evaluate the interface. ([composer](https://www.youtube.com/watch?v=If7iCPDy2vk&t=21s))

### Tension: interface first or marketing first

- Judge whether immediate use or prior explanation resolves the visitor’s largest uncertainty. Do not split the difference with a weak marketing page followed by a disconnected demo: lead with the composer when trying proves value, and lead with concise context when understanding or trust must come first. ([composer](https://www.youtube.com/watch?v=If7iCPDy2vk&t=21s))

## Preserve generation history

- Persist generated text, code, images, and other valuable artifacts in a browsable history. **Fails when:** outputs are deliberately ephemeral and low-value, such as autocomplete suggestions or tiny inline rewrites; recording each one would create noise. ([history](https://www.youtube.com/watch?v=If7iCPDy2vk&t=111s))
- Organize history around how users recall work: use chronological sessions for standalone conversations and attach versions to their source object for document or block edits. Support both views when the product genuinely contains both mental models. **Fails when:** one axis is forced across mixed workflows and hides relevant history. ([history](https://www.youtube.com/watch?v=If7iCPDy2vk&t=111s))
- Give every history item a recognition cue from its content: use a first-line snippet for text or a thumbnail for visual output, supplemented by metadata rather than replaced by it. **Fails when:** the artifact cannot be meaningfully previewed; use the most specific available identifier. ([history](https://www.youtube.com/watch?v=If7iCPDy2vk&t=111s))
- Include search in the first version of any history that can grow beyond one screen. Retention without retrieval turns accumulated value into clutter. ([history](https://www.youtube.com/watch?v=If7iCPDy2vk&t=111s))
- Let users delete individual history entries and prune unwanted results. **Fails when:** audit or compliance policy mandates retention; offer user-level hiding or another clearly labelled control without implying permanent erasure. ([history](https://www.youtube.com/watch?v=If7iCPDy2vk&t=111s))

## Make memory visible and editable

- Separate history from memory. Treat history as a record of past work and memory as a curated set of facts that can influence future behavior. ([history](https://www.youtube.com/watch?v=If7iCPDy2vk&t=111s))
- Place persistent memory in a dedicated, readily reachable product panel so users can understand unexpected personalization and correct wrong assumptions. Do not bury it deep in settings. ([history](https://www.youtube.com/watch?v=If7iCPDy2vk&t=111s))
- Let users inspect remembered facts, add facts directly, select multiple entries, and delete stale or incorrect entries in bulk. ([history](https://www.youtube.com/watch?v=If7iCPDy2vk&t=111s))
- Show used and remaining memory capacity when a real limit or retention policy exists. **Fails when:** capacity is effectively unbounded; a meter would invent scarcity without giving users a meaningful decision. ([history](https://www.youtube.com/watch?v=If7iCPDy2vk&t=111s))

## Support scoped AI editing

- Let users select part of an editable response and issue an instruction scoped to that selection. Preserve the rest of the artifact rather than regenerating it. **Fails when:** the output is not safely decomposable, such as a single result, tightly coupled chart, or code whose local modification can break global consistency. ([editing](https://www.youtube.com/watch?v=If7iCPDy2vk&t=168s))
- Anchor the AI edit affordance to the unit users already manipulate: selections for continuous prose and blocks or paragraphs for structured documents. ([editing](https://www.youtube.com/watch?v=If7iCPDy2vk&t=168s))
- Keep contextual controls compact and visually attached to the selection without covering surrounding content. **Fails when:** the edit needs several fields, attachments, or structured controls; escalate to a side panel. ([editing](https://www.youtube.com/watch?v=If7iCPDy2vk&t=168s))
- Pair a few high-frequency presets—such as rephrase, shorten, improve, or correct—with a free-text instruction. **Fails when:** presets grow beyond a quickly scannable handful; reduce them instead of turning the menu into a command catalog. ([editing](https://www.youtube.com/watch?v=If7iCPDy2vk&t=168s))
- Add a keyboard shortcut for contextual editing in writing-heavy desktop products. **Fails when:** the experience is touch-first; use selection handles and a contextual toolbar. ([editing](https://www.youtube.com/watch?v=If7iCPDy2vk&t=168s))
- Apply the result as a visible diff limited to the selected span, keeping everything outside it unchanged. **Fails when:** the request necessarily affects other locations; show the expanded diff and ask the user to review it rather than silently widening scope. ([editing](https://www.youtube.com/watch?v=If7iCPDy2vk&t=168s))
- Land scoped edits in place while retaining the surrounding content. Avoid blanking the artifact or showing a full-document loading state that implies complete regeneration. ([editing](https://www.youtube.com/watch?v=If7iCPDy2vk&t=168s))

## Explain grounded and multi-step work

- Show a compact process trail when the system genuinely retrieves sources, invokes tools, or passes intermediate artifacts through multiple stages. **Fails when:** the answer comes from a single model completion; never fabricate a reasoning trail or expose private chain-of-thought as theatre. ([process](https://www.youtube.com/watch?v=If7iCPDy2vk&t=230s))
- Summarize the process in roughly three to five verb-first phases, such as “Searching documents,” “Extracting evidence,” and “Drafting answer.” Group large or variable pipelines into meaningful phases instead of dumping internal calls. **Fails when:** exposing every stage produces an unreadable activity log. ([process](https://www.youtube.com/watch?v=If7iCPDy2vk&t=230s))
- Show how later phases depend on earlier results when the underlying workflow genuinely forms a chain. Do not imply reasoning dependencies between unrelated parallel operations. ([process](https://www.youtube.com/watch?v=If7iCPDy2vk&t=230s))
- Include concrete evidence objects—source titles, links, excerpts, or tool results—inside the trail whenever users can verify them. **Fails when:** sources are confidential, unstable, or too numerous; show counts or summaries and provide a controlled drill-in. ([process](https://www.youtube.com/watch?v=If7iCPDy2vk&t=230s))
- Use the process trail as the loading state when the wait is long enough to read it. **Fails when:** latency is so short that the trail would flash and disappear. ([process](https://www.youtube.com/watch?v=If7iCPDy2vk&t=230s))

### Tension: reveal stages progressively or disclose total scope

- Reveal each stage as it begins when live progression is the useful signal. Show the planned phases up front when users need scope, predictability, or cancellation decisions. **Fails when:** sequential reveals happen so quickly that they flicker, or withholding future stages conceals material work. ([process](https://www.youtube.com/watch?v=If7iCPDy2vk&t=230s))

## Design the wait

- Produce visible feedback quickly for any non-trivial AI operation; users react most strongly to uncertainty and apparent inactivity. **Fails when:** the action completes in roughly 300 milliseconds or less, where loading UI creates unnecessary flicker. ([waiting](https://www.youtube.com/watch?v=If7iCPDy2vk&t=266s))
- Put loading feedback exactly where the result will appear so the wait remains spatially tied to the action. **Fails when:** the operation genuinely blocks or invalidates the entire view; use an appropriately global state. ([waiting](https://www.youtube.com/watch?v=If7iCPDy2vk&t=266s))
- Use a small, fluid looping indicator between submission and the first meaningful output when completion percentage is unknowable. **Fails when:** a long operation has identifiable stages; show staged status instead of an abstract loop. ([composer](https://www.youtube.com/watch?v=If7iCPDy2vk&t=21s))
- Stream prose as it arrives so users can begin reading immediately. **Fails when:** output must be moderated, validated, parsed, or post-processed as a whole before it is safe or coherent to display. ([waiting](https://www.youtube.com/watch?v=If7iCPDy2vk&t=266s))
- For non-text generation with a predictable structure, render a skeleton matching the result’s real layout rather than a generic spinner. **Fails when:** the result’s shape is unknown; a specific skeleton would promise the wrong structure. ([waiting](https://www.youtube.com/watch?v=If7iCPDy2vk&t=266s))
- Match skeleton geometry to the loaded content so completion does not cause layout shift. **Fails when:** dimensions are genuinely variable; reserve the best defensible approximation and expect limited movement. ([waiting](https://www.youtube.com/watch?v=If7iCPDy2vk&t=266s))
- Animate skeletons with a restrained continuous shimmer or pulse so placeholders cannot be mistaken for failed rendering. **Fails when:** jobs last several minutes; pair motion with stage or progress information so the interface does not appear hung. ([waiting](https://www.youtube.com/watch?v=If7iCPDy2vk&t=266s))
- Design loading states with the same care as finished states, including deliberate typography, spacing, hierarchy, and motion. ([waiting](https://www.youtube.com/watch?v=If7iCPDy2vk&t=266s))

## Communicate confidence carefully

- Show answer-level confidence consistently whenever users will act on probabilistic output and the system has a meaningful, calibrated signal. Do not display it only for weak answers, because absence then becomes ambiguous. **Fails when:** the output is deterministic, quoted from a source of record, or backed by an uncalibrated score; a confidence badge would be theatre. ([confidence](https://www.youtube.com/watch?v=If7iCPDy2vk&t=310s))
- Translate calibrated numeric scores into a defined set of plain-language bands, and make the lowest band explicitly say “uncertain” or “unverified.” **Fails when:** the score does not track real-world accuracy; banding noise makes it look authoritative. ([confidence](https://www.youtube.com/watch?v=If7iCPDy2vk&t=310s))
- Place confidence directly below the answer it describes so it cannot be mistaken for a property of the whole session or model. ([confidence](https://www.youtube.com/watch?v=If7iCPDy2vk&t=310s))
- Present confidence as visually subordinate, interactive metadata—typically a compact horizontal pill—and reveal the underlying value or explanation on demand. **Fails when:** confidence is the primary decision variable, such as in a triage queue; promote it to a sortable field or visualization. ([confidence](https://www.youtube.com/watch?v=If7iCPDy2vk&t=310s))

### Tension: plain-language labels or inline numbers

- Prefer plain-language confidence labels for general audiences and keep percentages one interaction away. Show calibrated numbers inline for expert evaluation tools where precision is necessary and users understand the metric. ([confidence](https://www.youtube.com/watch?v=If7iCPDy2vk&t=310s))

## Boundaries

- Apply these patterns to the controls, transparency, revision, memory, history, latency, and trust experience of AI products. Do not interpret this skill as permission to use generative tools to create the interface itself.
