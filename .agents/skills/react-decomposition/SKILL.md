---
name: somnara-react-decomposition
description: somnara house style for decomposing large React feature components into context + state-hook + per-step files. Use BEFORE editing or when reviewing any feature component over ~400-500 lines, any multi-step "flow"/wizard, or a component with heavy prop-drilling or 10+ useState at one root. Triggers when splitting a monolith, adding a step to a guided flow, or refactoring a ReactFlow graph / TanStack Table component in `apps/web/src`.
---

# somnara React Decomposition

Split oversized feature components into small, single-responsibility files
without changing behavior or import paths. The canonical references are the
already-decomposed guided flows:

- `apps/web/src/features/guided/components/simple-asset-flow/`
- `apps/web/src/features/guided/components/simple-audit-flow/`

Read the actual on-disk files before mirroring them — they are the source of
truth (see Process lessons; the reference can change mid-task).

## When to apply

- Any feature component file over ~400–500 lines.
- Any multi-step "flow" / wizard.
- Heavy prop-drilling, or 10+ `useState` at one component root.

## Canonical flow-style structure (default for guided flows / wizards)

Use this for guided flows and multi-step wizards.

- **`<name>.tsx` = thin BARREL.** Re-export the public surface so existing
  import paths never change. Re-export EVERY symbol the old file exported —
  including cross-feature shared ones. Real example: `simple-asset-flow.tsx`
  keeps `export { SimpleBottomNav }` because `simple-audit-flow`,
  `simple-contracts-flow`, and `simple-risks-flow` import it from that path.
- **`<name>/index.tsx` = composition root.** `export function X()` wraps
  `<XProvider><XContent /></XProvider>`. `XContent` holds the loading guard,
  the header, and the `{step === N && <StepN />}` switch.
- **`<name>/context.tsx`** = `createContext<XState | null>(null)` + `XProvider`
  (calls the state hook and provides it) + a `useX()` accessor that throws
  `"useX must be used within XProvider"` when the value is null.
- **`<name>/use-<name>-state.ts`** = ALL state, queries, mutations, derived
  maps, and handlers hoisted into one `useXState()` hook returning a single
  object. Export shared constants (e.g. `STEP_KEYS`) and
  `export type XState = ReturnType<typeof useXState>`.
- **Presentational children** (header, tip, each step) call `useX()` to read
  what they need — NO prop-drilling.
- **Genuinely reusable LEAF components stay prop-driven.** Real examples:
  `InlineDependencyEditor`, `InlinePersonSelect` take explicit props rather
  than reading context.
- **Multi-step flows use a `steps/` subfolder.** A heavy step gets its OWN
  subfolder with `index.tsx` (the step) + sibling card components. Real
  examples: `simple-audit-flow/steps/quick-audit/` and `steps/improvements/`.
- **Pure constants → their own `.ts`** (e.g. `constants.tsx`,
  `pdca-journey-steps.ts`). **Pure helpers → their own `.ts`** (e.g.
  `template-helpers.ts` holding `findBestTemplate` / `templateToAssets` /
  `mergeAssetsWithDeps`).

## Not everything is flow-shaped — pick by component type

- **ReactFlow graph / visualization** (e.g. `asset-dependency-map.tsx`):
  extract node components, custom edge components, and a connection picker into
  a `graph/` subfolder; move colors / type maps / i18n-key maps and
  `layoutNodes` / `buildEdges` to `graph-constants.ts` / `graph-layout.ts`.
  Keep the main file as ReactFlow wiring + state. Do NOT force a context.
- **TanStack Table** (e.g. `asset-overview-table.tsx`): split into toolbar,
  filters (`FilterPill` / `ScopeTab`), column definitions, the inline add-form,
  and the table wrapper. A small context for add/filter state is fine.
- **Data modules** (e.g. `data/assets.ts`, `data/collection.ts`): these are
  type / constant / collection definitions — leave them. Only extract helpers
  if a UI file inlined logic that belongs in the data layer.

## Non-negotiable correctness rules

- **Behavior must be IDENTICAL — a pure structural move.** Preserve JSX output,
  i18n keys, classNames, and logic verbatim.
- **Move tricky bits intact into the state hook**: render-time init blocks
  (`if (!initializedRef.current && !isLoading) { … }`) and draft-persisting
  setter wrappers (`setAssets` / `setStep` that also call `saveDraft`).
- **NEVER edit consumer files.** Keep the import path working via the barrel.
  After splitting, grep every importer of the module path and confirm it still
  resolves.
- **Verify before declaring done.** Run `cd apps/web && bun run typecheck` and
  confirm zero NEW errors mentioning the touched files (the WIP branch has
  unrelated pre-existing errors — diff against a clean tree / stash to be
  sure), then run oxlint.

## Fold in these somnara quick-wins while refactoring

- **IDs**: use `createId(ID_PREFIX.x)` from `@somnara/shared` — never
  `Date.now()` or template-literal ids like `` `asset-${Date.now()}` `` (real
  offenders existed in `steps/asset-list.tsx` and `asset-dependency-map.tsx`).
  See the `somnara-shared-utils` skill.
- **Reuse `@somnara/shared` helpers**; dedupe inline helpers that already
  exist elsewhere. Real example: `InlinePersonSelect` was copy-pasted across
  `steps/asset-list.tsx` and `asset-overview-table.tsx` — extract one shared
  `components/inline-person-select.tsx`.
- **Prefer shadcn/ui controls over native inputs** (existing repo preference).

## Process lessons (working in this monorepo)

- The reference implementation can change under you mid-task (the audit flow was
  itself being restructured into `steps/` subfolders during the asset split).
  Treat the ACTUAL on-disk reference files as the source of truth — not a stale
  `ls` / `find` snapshot or a prior assumption.
- After a big multi-file move, independently re-verify the final tree, the
  barrel re-exports, importer resolution, and typecheck. Don't trust the move
  blind.
