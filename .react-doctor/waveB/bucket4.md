# Wave B — Agent bucket 4


## src/shared/components/ui/chart.tsx
- L177 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..
- L276 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..
- L144 [restrict-template-expressions] Invalid type used in template literal expression.
- L180 [restrict-template-expressions] Invalid type used in template literal expression.
- L279 [restrict-template-expressions] Invalid type used in template literal expression.

## src/features/resources/components/service/tabs/settings/deploy-hooks-card.tsx
- L34 [js-flatmap-filter] This loops over your list twice because .map().filter(Boolean) makes two passes, so use .flatMap() to change & drop item
- L92 [rerender-lazy-state-init] useState(map()) re-runs map() on every render & throws the result away.
- L93 [rerender-lazy-state-init] useState(map()) re-runs map() on every render & throws the result away.

## src/features/resources/components/_shared/variables-editor/use-editor-state.ts
- L106 [js-combine-iterations] This loops over your list twice because .map().filter() makes two passes, so do it in one pass with .reduce() or a for..
- L127 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..

## src/shared/components/ui/card.tsx
- L59 [no-unused-vars] Function 'CardAction' is declared but never used.
- L79 [no-unused-vars] Function 'CardFooter' is declared but never used.

## src/features/edge-logs/data/use-edge-bans.ts
- L22 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..

## src/features/logs/data/use-project-log-stream.ts
- L116 [js-tosorted-immutable] This wastes work because [...array].sort() copies the array just to sort it, so use array.toSorted() to sort without the

## src/features/projects/components/new-resource/steps/kind.tsx
- L15 [no-redundant-type-constituents] is overridden by string in this union type.

## src/features/projects/components/pending-changes-groups.ts
- L116 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..

## src/features/resources/components/_shared/variables-editor/dotenv-parse.ts
- L48 [js-tosorted-immutable] This wastes work because [...array].sort() copies the array just to sort it, so use array.toSorted() to sort without the

## src/features/resources/components/postgres/tabs/data/studio-sql-toolbar.tsx
- L112 [label-has-associated-control] Blind users can't identify this field because screen readers find no label text, so add visible text, `aria-label`, or `

## src/features/resources/data/service-domains.ts
- L44 [unused-export] Unused export: `serviceDomainsCollection` is exported but no module imports it, so it expands the public surface and can

## src/features/volumes/data/volumes.ts
- L32 [unused-export] Unused export: `inspectVolume` is exported but no module imports it, so it expands the public surface and can mislead ca

## src/routes/_app/$orgSlug/_shell/$projectSlug/-components/networking-routes-tab.tsx
- L57 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..

## src/shared/components/data-grid/data-grid-cell-wrapper.tsx
- L154 [prefer-tag-over-role] Screen reader users get more reliable semantics from `<button>` than `role="button"`, so use `<button>` instead.

## src/shared/components/ui/native-select.tsx
- L49 [no-unused-vars] Function 'NativeSelectOptGroup' is declared but never used.

## src/shared/components/ui/svgs/nuxt.tsx
- L6 [rendering-svg-precision] Your users download extra bytes for SVG d precision they can't see, so round it to 1 or 2 decimals.

## src/shared/db/sqlite-persistence.ts
- L45 [no-console] Unexpected console statement.
