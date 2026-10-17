# designer skill library

Fifteen topic skills synthesized from 51 product-design videos (365 chapter-level
analyses, 2,159 cited teachings). Built by the pipeline in
`~/Developer/agents/designer`; see that repo's `docs/PIPELINE.md`.

Every teaching in a `SKILL.md` carries a timestamped YouTube citation, so a claim
can be traced back to the source talk. `references/teachings.jsonl` in each skill
holds the lossless raw teachings; `references/sources.md` lists the videos.

- `_taxonomy.json` — the 15 clusters and what each one owns.
- `_assignments.json` — which source chapter fed which skill.

Not hand-written: regenerate upstream rather than editing these in place.

## The fifteen

| skill | owns |
|---|---|
| `frame-product-strategy` | positioning, audience, what the product is for |
| `scope-and-prove-design-work` | scoping a design task, proving it worked |
| `architect-flows-and-navigation` | flows, IA, navigation structure |
| `compose-responsive-layouts` | layout, grid, breakpoints, density |
| `build-type-systems` | type scale, pairing, hierarchy |
| `engineer-ui-colour-and-depth` | colour roles, contrast, elevation, depth |
| `build-component-systems` | tokens, components, variants, reuse rules |
| `design-data-experiences` | tables, charts, dashboards, dense data |
| `design-feedback-and-ethical-states` | empty/error/loading states, honest feedback |
| `prototype-and-implement-motion` | motion, transitions, animation implementation |
| `art-direct-brand-and-imagery` | brand expression, imagery, art direction |
| `adapt-platform-interfaces` | platform conventions, native vs web |
| `design-ai-product-experiences` | AI-product surfaces and affordances |
| `generate-and-refine-ui-with-ai` | generating and iterating UI with AI tooling |
| `research-critique-and-iterate` | research, critique, iteration loops |
