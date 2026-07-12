# Wave B — Agent bucket 3


## src/features/logs/components/log-viewer.tsx
- L14 [no-unused-vars] Identifier 'Alert02Icon' is imported but never used.
- L15 [no-unused-vars] Identifier 'CancelCircleIcon' is imported but never used.
- L16 [no-unused-vars] Identifier 'Copy01Icon' is imported but never used.
- L17 [no-unused-vars] Identifier 'Search01Icon' is imported but never used.
- L19 [no-unused-vars] Identifier 'HugeiconsIcon' is imported but never used.

## src/features/resources/components/compose/exposed-editor.tsx
- L147 [control-has-associated-label] Blind users can't tell what this control does because screen readers find no label, so add visible text, `aria-label`, o
- L39 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..
- L154 [js-set-map-lookups] This scales poorly because `array.includes()` inside a loop scans the whole list every time. Use a Set for constant-time

## src/features/resources/components/_shared/variables-editor/index.tsx
- L81 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..
- L84 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..

## src/shared/components/ui/alert.tsx
- L38 [no-unused-vars] Function 'AlertTitle' is declared but never used.
- L64 [no-unused-vars] Function 'AlertAction' is declared but never used.

## src/features/edge-logs/components/host-filter.tsx
- L74 [js-set-map-lookups] This scales poorly because `array.includes()` inside a loop scans the whole list every time. Use a Set for constant-time

## src/features/logs/components/logs-histogram.tsx
- L195 [control-has-associated-label] Blind users can't tell what this control does because screen readers find no label, so add visible text, `aria-label`, o

## src/features/projects/components/new-resource/form-context.ts
- L40 [unused-export] Unused export: `withForm` is exported but no module imports it, so it expands the public surface and can mislead callers

## src/features/projects/components/pending-changes-bar.tsx
- L79 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..

## src/features/resources/components/_shared/staged-panel.tsx
- L109 [unused-export] Unused export: `StagedResourcePanel` is exported but no module imports it, so it expands the public surface and can misl

## src/features/resources/components/postgres/tabs/data/data/filters.ts
- L116 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..

## src/features/resources/data/resource.ts
- L100 [no-unused-vars] Function 'createResourceTasksCollection' is declared but never used.

## src/features/templates/components/template-detail-sections.tsx
- L32 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..

## src/routes/_app/$orgSlug/-components/settings-cloudflare.tsx
- L205 [label-has-associated-control] Screen reader users can't tell which input this label names because it's tied to none, so add `htmlFor` or wrap the inpu

## src/routes/_app/$orgSlug/layout.tsx
- L32 [unbound-method] Avoid referencing unbound methods which may cause unintentional scoping of `this`.

## src/shared/components/data-grid/lib/data-grid.ts
- L352 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..

## src/shared/components/ui/svgs/nocodb.tsx
- L9 [rendering-svg-precision] Your users download extra bytes for SVG d precision they can't see, so round it to 1 or 2 decimals.

## src/shared/components/ui/toggle.tsx
- L30 [no-unused-vars] Function 'Toggle' is declared but never used.
