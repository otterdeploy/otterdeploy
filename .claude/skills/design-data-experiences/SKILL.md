---
name: design-data-experiences
description: "Load when an agent must turn datasets, metrics, or analytical tasks into accurate and decision-oriented interfaces."
---

## Operating sequence

- Define the decision, user, and primary job before choosing modules. Put the core object or answer in the top-left, and split genuinely co-equal workflows into separate routes. **Fails when:** Several tasks must be monitored together; preserve the shared view but make their priorities explicit. ([dashboard-system](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=100s))
- Audit the domain’s information model, not merely the supplied dataset. Add essential dimensions the concept omitted—for example, liabilities in a financial overview. ([dashboard-composition](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=406s))
- **Corroborated:** Fix information architecture before visual styling. Count discrete elements, consolidate related content, remove weak containers, and only then tune typography, colour, and spacing. **Fails when:** The structure is fixed or already sound and the task is explicitly surface-level. ([dashboard-structure](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=0s), [density-audit](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=126s))
- Delete any element whose purpose cannot be stated quickly. Confirm unfamiliar domain-specific elements with real users before cutting them. ([density-audit](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=126s))
- Remove decorative panels, fake controls, and tiles with no data, interaction, or destination. Preserve deliberate onboarding and empty-state placeholders. Sweep generated interfaces for this failure first. ([billing-audit](https://www.youtube.com/watch?v=PDcQJOPby1k&t=189s))
- Judge every module by decision value per unit of space. Remove or relocate oversized surveys, promotions, and secondary prompts unless they are requirements or the screen’s conversion goal. ([density-audit](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=126s))
- Park uncertain, non-required modules outside the canvas and reconsider them after the structure settles. Do not defer hard requirements that need reserved space. ([density-audit](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=126s))
- Compare revisions side by side so changes in hierarchy, density, alignment, and de-emphasis remain visible. ([data-components](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=0s))
- Recheck every region affected by a structural change; space gained in one part of a fixed viewport is usually taken from another. ([density-audit](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=126s))
- Rewrite a page coherently when several independent sections fail together. **Fails when:** Production dependencies make a wholesale rebuild riskier than incremental repair. ([billing-audit](https://www.youtube.com/watch?v=PDcQJOPby1k&t=189s))
- Validate unfamiliar but conventional patterns against shipped products and real analytics tools, not portfolio shots. Study task flow and data behaviour, not surface styling. **Fails when:** The experience is the product’s differentiator or the reference product has incompatible constraints. ([chart-legibility](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=382s), [dashboard-system](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=100s), [billing-redesign](https://www.youtube.com/watch?v=PDcQJOPby1k&t=247s))

## Resolve structural tensions

- Judge this tension explicitly: establish the persistent shell first when it determines the canvas, but design content-rich modules before freezing a new grid when their natural sizes are unknown. If the shell already exists, work inward from its constraints. ([dashboard-structure](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=0s), [dashboard-composition](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=406s))
- Temporarily hide stable chrome while auditing content density, then restore its real dimensions before committing the layout. **Fails when:** Navigation is in scope or changing its width will invalidate the audit canvas. ([density-audit](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=126s))
- Separate representation from placement: first choose the form that matches the data, then decide whether it belongs in the main area, a secondary column, or a pop-out. ([data-components](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=0s))
- Hold the result to structural simplicity, visual quality, and task usability simultaneously. Treat a dashboard that only photographs well as unfinished. ([dashboard-structure](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=0s))

## Compose the dashboard

- Assign every module a high, medium, or low priority from business importance and usage frequency. Place high-priority modules first in reading order, resolving packing ties by fit. **Fails when:** Rare but critical controls require prominence despite low frequency. ([dashboard-composition](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=406s), [module-content](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=314s))
- Reserve the top strip for page-level scope controls and actions, usually one primary action plus a filter or selector. ([dashboard-system](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=100s))
- Commit to a strict grid and shared gutters. Fit fewer, larger items before violating established module margins. **Fails when:** Tables and logs deliberately use a denser internal specification. ([dashboard-system](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=100s), [module-content](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=314s))
- Match module shape to reading direction: use wide, short regions for short homogeneous rows with filters, and taller regions for vertical scanning. **Fails when:** A long list would require excessive paging in the shorter form. ([module-content](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=314s))
- Compare viable arrangements by the usefulness of their residual space. Do not stretch modules or invent decorative filler merely to close an awkward gap. Add a module only if the gap exposes genuinely missing content. ([dashboard-composition](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=406s))
- Spend newly available width on clearer hierarchy and additional decision information, not uniform stretching. ([billing-redesign](https://www.youtube.com/watch?v=PDcQJOPby1k&t=247s))
- Use a compact dashboard type scale with closely spaced body and label sizes, roughly 11–16 px where accessibility and platform conventions permit. **Fails when:** Designing a low-density marketing surface that needs display-scale hierarchy. ([dashboard-system](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=100s))
- Give supplementary charts less space and interaction weight. **Fails when:** Inspecting that data—such as investments—is the product’s primary task. ([chart-function](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=245s))
- Promote a call to action into its own module only when the action is a frequent primary function and has enough supporting context to justify the container. Otherwise keep the button with its object. ([module-content](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=314s))

## Build coherent modules

- Co-locate a control with the object it changes. Give a control its own module only when it is global or acts across several objects. ([density-audit](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=126s))
- **Corroborated:** Combine a metric, its delta, and its trend in one complete module when they describe the same quantity. **Fails when:** The derivative is itself the primary KPI, or the chart spans multiple metrics and needs a dedicated panel. ([density-audit](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=126s), [dashboard-composition](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=406s))
- Keep exact values beside visual encodings whenever operational precision matters; charts show relationship, while figures support action. ([dashboard-composition](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=406s))
- Add a visual only when a metric has a comparison, distribution, denominator, or time dimension worth encoding. Prefer a well-set scalar when there is nothing meaningful to plot, and remove charts that merely repeat the number. ([chart-function](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=245s), [dashboard-composition](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=406s))
- Move low-value supporting metrics into disclosure or overflow rather than flattening the card hierarchy. **Fails when:** The metric is required or is what most users came to inspect. ([dashboard-composition](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=406s))
- Position secondary row actions after the data, commonly at the bottom of the content area. **Fails when:** Performing the action is the row’s primary purpose. ([analytics-polish](https://www.youtube.com/watch?v=PDcQJOPby1k&t=302s))
- Replace abstract visual metaphors with concrete events: use a recognisable status icon followed by the facts users check first, such as amount, date, and location. **Fails when:** The visual is intentionally tone-setting on a brand or marketing surface. ([module-content](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=314s))
- Start exception and alert cards with a discriminating alert icon, then order facts as what happened, magnitude, time, and location. **Fails when:** Every card receives the same icon and the signal becomes decoration. ([module-content](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=314s))
- Reuse a well-crafted visual form only if its encoding remains truthful after reorientation or recolouring. Never salvage a fundamentally wrong chart type. ([module-content](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=314s))
- Replace ambiguous or undersized icons with text buttons. Retain universally understood glyphs when a label would add no meaning. ([module-content](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=314s))
- Avoid unlabelled pagination dots as the primary navigation for data modules. Use destination-labelled controls; keep dots only as passive position indicators or companions to swipe navigation. ([module-content](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=314s))
- Give every truncated preview a visible “view all” route; place “add” beside it when entries can be created. Add filters when limited slots must represent a larger dataset. **Fails when:** The displayed set is complete or too small for filtering to matter. ([module-content](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=314s))

## Design lists and tables

- Group dense records by a meaningful retrieval attribute before adding space to every row. **Fails when:** Grouping can hinder comparison when users need a single stable ordering. ([scannable-ui](https://www.youtube.com/watch?v=neE6wOuBIP8&t=112s))
- Use recognizable avatars to distinguish people referenced in dense records. **Fails when:** Unfamiliar or similar avatars still need readable names. ([scannable-ui](https://www.youtube.com/watch?v=neE6wOuBIP8&t=112s))
- Choose each field’s component from its data characteristics: categorical values become labels or chips, comparable quantities become aligned numerics, identity gets a recognisable token, and long text receives controlled disclosure. ([data-components](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=0s))
- Right-align comparable numeric columns and use tabular figures so place values align. Left-align identifiers such as phone numbers, postal codes, and IDs because their apparent magnitude is meaningless. ([data-components](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=0s))
- Use chips only for small, closed value sets. Keep open-ended or high-cardinality values as plain text; abandon colour coding when the set becomes too large to distinguish. ([data-components](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=0s))
- Truncate long secondary text to protect useful column proportions, and expose the complete value on demand. **Fails when:** Reading that text is the main task or truncation hides the distinguishing portion. ([data-components](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=0s))
- Limit overview-list rows to roughly four or five meaningful fields: identity, primary value, context, time, and one performance signal. **Fails when:** Users opened a dedicated reporting table to compare many columns and expect column controls. ([dashboard-system](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=100s))
- Prefer a divider-separated list for many homogeneous records; reserve individually bordered cards for heterogeneous or independently actionable objects. ([dashboard-system](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=100s))
- Add genuine secondary metadata or actionable metrics when a row is needlessly sparse; shorten the row when no useful information exists. Do not manufacture filler to achieve density. ([dashboard-system](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=100s), [analytics-polish](https://www.youtube.com/watch?v=PDcQJOPby1k&t=302s))
- Design populated and empty states together so the collection’s structure degrades gracefully for a new account. ([dashboard-system](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=100s))
- Support multi-selection where bulk archive, delete, tag, or export is realistic. Reveal contextual bulk controls only after selection. ([dashboard-system](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=100s))
- Encode inactive or archived state in the row treatment as well as its label. **Fails when:** De-emphasis violates contrast requirements or those rows are the current work target. ([data-components](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=0s))
- Use a timeline when sequence and interval define the dataset. Use a table when users must sort, filter, or compare many non-temporal attributes, or when event volume defeats timeline scanning. ([data-components](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=0s))
- Show recurring known actors with avatars alongside names. **Fails when:** People are unfamiliar, one-off, missing useful avatars, or too numerous for visual recognition. ([data-components](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=0s))
- Add a summary chart above a list only when a meaningful dimension—usually time or category—can answer an aggregate question. Remove decorative roll-ups that hide the individual records users need. ([data-components](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=0s))

## Select truthful charts

- Default to familiar encodings: lines for change over time and bars for categorical comparison. Reject decorative forms whose visual grammar is not immediately recognisable. ([dashboard-system](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=100s))
- Choose the chart from the relationship, not the desired silhouette. Use donut or pie charts only for a small number of parts of a fixed whole; use bars when slices are numerous or close values require precise comparison. ([dashboard-composition](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=406s))
- Use a diverging bar chart for genuinely opposing measures over a shared axis, such as inflow and outflow. **Fails when:** The categories are not semantic opposites or one side’s scale makes the other illegible. ([dashboard-composition](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=406s))
- Pair a choropleth with a ranked numeric list when spatial distribution matters. **Fails when:** Only a few locations contain data or rank order—not geography—is the real question. ([analytics-polish](https://www.youtube.com/watch?v=PDcQJOPby1k&t=302s))
- Match the number of marks exactly to the dataset. Never invent bars, points, or slices to balance a composition. ([chart-legibility](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=382s))
- Keep bar ends square or only subtly rounded, approximately 2–4 px. **Fails when:** The mark is a labelled pill-shaped progress or capacity meter whose exact cap is not read independently. ([chart-legibility](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=382s))
- Label categorical axes with real category names. In dense time series, label representative intervals and expose exact points through interaction. ([chart-legibility](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=382s))
- Reuse product identity tokens—avatars, favicons, or logos—beside categorical labels when they help users connect chart entities with list records. ([dashboard-system](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=100s))
- Prefer the plainer chart whenever aesthetic treatment impairs accurate reading. Exempt purely illustrative editorial graphics that make no quantitative claim. ([chart-legibility](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=382s))
- Evaluate chart aesthetics and chart function separately so polish cannot conceal an unreadable encoding. Diagnose once under the current size constraint and again assuming that constraint can change. ([line-chart](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=115s))

## Build axes, lines, and legends

- **Corroborated:** Give quantitative charts visible value axes, labelled ticks, context labels, and useful gridlines. If an axis is intentionally removed, place exact values directly on or beside every mark. **Fails when:** A sparkline is only an inline trend glyph and its exact value appears nearby. ([chart-legibility](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=382s), [dashboard-system](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=100s), [chart-function](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=245s))
- Draw time-series lines with straight, opaque segments. Disable spline or Bézier smoothing because it invents intermediate extrema. Exempt non-data marketing illustrations. ([chart-function](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=245s), [line-chart](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=115s))
- Show real measurement points on analytical line charts. Omit markers only for deliberate sparklines or series dense enough that markers would obscure the line. ([line-chart](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=115s))
- Keep the latest observed segment fully legible. Render forecasts or incomplete periods with an explicitly labelled dashed treatment, never an unexplained fade. ([line-chart](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=115s))
- Add horizontal gridlines for value reading and vertical gridlines aligned with time ticks when the plot is large enough. Remove vertical lines when they compete with the data in a small card. ([line-chart](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=115s))
- Add a legend for every multi-series chart unless each line is directly labelled or the encoding is genuinely self-evident. ([line-chart](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=115s))
- Move chart titles into a clear header rather than consuming plot area, especially when enlarging the visualization. ([line-chart](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=115s))

## Add analytical controls and comparisons

- Pair a dashboard chart with a headline value and explicit reporting period so users can answer the summary question before reading the plot. ([dashboard-system](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=100s))
- Expose meaningful time ranges directly as a segmented control when space permits; collapse them into a dropdown only under real width pressure. Omit the control for fixed-period data. ([line-chart](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=115s))
- Reuse one range-selector and metric-switcher pattern across the page. Toggle related metrics within a chart instead of multiplying chart panels. ([dashboard-system](https://www.youtube.com/watch?v=B7k5rOgmOGY&t=100s))
- Let aggregate metrics expand into per-entity series so users can compare the items behind the total. ([analytics-polish](https://www.youtube.com/watch?v=PDcQJOPby1k&t=302s))
- Plot the equivalent previous period as a subordinate comparison series when “better or worse than last period” is the decision. **Fails when:** Previous-period values are not a meaningful benchmark, as with many absolute portfolio balances. ([line-chart](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=115s))
- Use compact delta chips at repeated hierarchy levels when users need quick percentage comparisons. **Fails when:** Users need the temporal shape or cause of each change. ([chart-function](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=245s))
- Judge the fullscreen-control tension by information gain: enlarge the chart in place when scale is the only benefit; add a drill-down route when it offers richer data, comparisons, or inspection tools. ([chart-function](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=245s), [dashboard-composition](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=406s), [line-chart](https://www.youtube.com/watch?v=gKM6b2EnW1k&t=115s))

## Use colour deliberately

- Derive salient dashboard colour from state, category, or another named data field. Remove colour whose meaning cannot be explained. **Fails when:** Working on expressive, low-frequency marketing surfaces. ([data-components](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=0s))
- Reserve red and other high-salience colours for the minority of entries requiring attention. Apply them to compact icons or chips rather than flooding whole rows. **Fails when:** Urgent entries are so common that colour no longer discriminates. ([data-components](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=0s))
- Resolve the accent-colour tension by colouring metric icons only when the colour reinforces a stable category or scanning cue. Do not use arbitrary icon colour that competes with meaningful status and chart encodings. ([analytics-polish](https://www.youtube.com/watch?v=PDcQJOPby1k&t=302s), [data-components](https://www.youtube.com/watch?v=Ksx9C2-3yMo&t=0s))

## Design usage and billing views

- Separate consumption analysis from plan and payment management with tabs when they are distinct tasks. Keep them together when users must consult both in one glance. ([billing-audit](https://www.youtube.com/watch?v=PDcQJOPby1k&t=189s))
- Show quota, seat, credit, or storage usage against its known ceiling with a compact consumed-versus-remaining visual and exact figures. **Fails when:** The metric is unbounded or has no meaningful denominator. ([billing-audit](https://www.youtube.com/watch?v=PDcQJOPby1k&t=189s))
- Make the recurring price the dominant element in plan-choice cards and demote the plan name. Reverse that hierarchy when the task is confirming the current plan’s identity. ([billing-redesign](https://www.youtube.com/watch?v=PDcQJOPby1k&t=247s))
- Order tier prices monotonically. When promotions disrupt the ladder, show the standard price struck through, label the discount, and expose the actual savings as a distinct benefit. ([billing-audit](https://www.youtube.com/watch?v=PDcQJOPby1k&t=189s), [billing-redesign](https://www.youtube.com/watch?v=PDcQJOPby1k&t=247s))
- Limit self-serve comparisons to roughly three or four tiers and remove overlapping offers, often the weakest entry tier. Preserve additional tiers only when they map to genuinely distinct segments. ([billing-audit](https://www.youtube.com/watch?v=PDcQJOPby1k&t=189s))
- Name tiers after the customer scale implied by their limits so users can self-select credibly. ([billing-redesign](https://www.youtube.com/watch?v=PDcQJOPby1k&t=247s))
- Show the next tier’s concrete delta on the current-plan card instead of sending users to a generic matrix. **Fails when:** The user is already on the top tier or the only difference is visible in the usage meter. ([billing-redesign](https://www.youtube.com/watch?v=PDcQJOPby1k&t=247s))
- Include plan, price, billing email, and payment method in the billing settings surface. ([billing-redesign](https://www.youtube.com/watch?v=PDcQJOPby1k&t=247s))
- Use a tabbed settings shell when capability domains are expected to grow. **Fails when:** Sections are few and stable, or tabs exceed one row and require awkward overflow. ([billing-redesign](https://www.youtube.com/watch?v=PDcQJOPby1k&t=247s))
- Populate every new tab or navigation destination in the same pass; never ship empty information architecture. ([billing-redesign](https://www.youtube.com/watch?v=PDcQJOPby1k&t=247s))
- Subtract non-decision content before adding billing details, then retune hierarchy on what remains. ([billing-redesign](https://www.youtube.com/watch?v=PDcQJOPby1k&t=247s))

## Design financial dashboards

- Pair investment summaries with clear gridlines, useful time controls, and comparison or detail access only when those operations aid inspection. Avoid comparison baselines that are financially meaningless. ([chart-function](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=245s))
- Show opposing financial flows, such as income and expense, with a shared-baseline diverging chart while retaining exact monetary values. ([dashboard-composition](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=406s))
- Treat credit used versus available as part-to-whole data when the total is fixed and the segment count is small. Switch to bars when precision or multiple accounts matter more. ([dashboard-composition](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=406s))
- Make fraud, lock, and exception controls prominent according to consequence, even if users rarely invoke them. ([module-content](https://www.youtube.com/watch?v=Yr2uIcFZDDQ&t=314s))

## Tell personal data stories

- Organize personal analytics into a small set of named chapters, each answering one user question. Use a dashboard instead when simultaneous metric comparison is the actual task. ([recap-storytelling](https://www.youtube.com/watch?v=goWOAFqJHpA&t=188s))
- Preserve expected headline metrics, then add a few credible secondary insights that reveal unnoticed behaviour. Remove metrics that feel judgmental, inaccurate, or purposeless. ([recap-storytelling](https://www.youtube.com/watch?v=goWOAFqJHpA&t=188s))
- Preserve successful familiar recap conventions and improve navigation incrementally. Replace the legacy structure only when it blocks the core task and retains no useful learned behaviour. ([recap-navigation](https://www.youtube.com/watch?v=goWOAFqJHpA&t=34s))
- Provide a fast scanning route for recap results users revisit or share. Prefer scrolling across many ordered moments; preserve discrete progression when timing, transitions, or acknowledgement are essential. ([recap-navigation](https://www.youtube.com/watch?v=goWOAFqJHpA&t=34s))
- Combine persistent recap navigation with visible progress when media requires orientation. Use the right edge only when it fits platform, accessibility, handedness, and surrounding-interface conventions. ([recap-navigation](https://www.youtube.com/watch?v=goWOAFqJHpA&t=34s))
- Frame affinity metrics as changes, discoveries, or relationships over time—not only totals. Omit comparisons when historical periods are absent, sparse, or incompatible. ([recap-storytelling](https://www.youtube.com/watch?v=goWOAFqJHpA&t=188s))
- Let users inspect every meaningful month in a chronological journey. Summarize or filter when the timeline is too long or sparse to browse efficiently. ([recap-storytelling](https://www.youtube.com/watch?v=goWOAFqJHpA&t=188s))
- Encode subjective qualities with an intuitive, stable visual mapping and historical comparison. Remove the encoding when users cannot interpret it consistently. ([recap-storytelling](https://www.youtube.com/watch?v=goWOAFqJHpA&t=188s))
- Turn shareable summaries into compact, immediately recognisable artifacts whose metaphor supports the insight. Reject metaphors that obscure data, exclude audiences, or overpower the result. ([recap-storytelling](https://www.youtube.com/watch?v=goWOAFqJHpA&t=188s))
- Prefer understandable categories over novelty-generated labels when users need to recognise themselves. Use generated labels only when they are transparent, controllable, and demonstrably more useful. ([recap-storytelling](https://www.youtube.com/watch?v=goWOAFqJHpA&t=188s))

## Stay within scope

- Apply this skill to analytical interfaces, data modules, billing and usage views, financial dashboards, and personal recaps—not generic marketing-page layout, product-imagery composition, or landing-page prioritisation. Route those concerns to a frontend or marketing-design skill. ([analytics-polish](https://www.youtube.com/watch?v=PDcQJOPby1k&t=302s))
- Keep backend event collection, metric definitions, data pipelines, and analytics instrumentation outside this skill; request trustworthy data contracts before designing their presentation. ([chart-legibility](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=382s))
