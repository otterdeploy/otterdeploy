# Wave B — Agent bucket 2


## src/shared/components/data-grid/hooks/use-data-grid.ts
- L711 [async-await-in-loop] This makes the for-loop slow because each await runs one after another, so collect the independent calls & run them toge
- L2113 [js-combine-iterations] This loops over your list twice because .filter().filter() makes two passes, so do it in one pass with .reduce() or a fo
- L823 [js-flatmap-filter] This loops over your list twice because .map().filter(Boolean) makes two passes, so use .flatMap() to change & drop item
- L1807 [js-index-maps] This gets slow as your list grows because array.findIndex() runs inside a loop, so build a Map once before the loop for 
- L577 [no-base-to-string] 'value ?? ""' will use Object's default stringification format ('[object Object]') when stringified.
- L1448 [no-base-to-string] 'value ?? ""' will use Object's default stringification format ('[object Object]') when stringified.
- L380 [no-new-array] Do not use `new Array(singleArgument)`.

## src/features/backups/multi-combobox.tsx
- L78 [click-events-have-key-events] Keyboard users can't trigger this click handler because there's no keyboard one, so add `onKeyUp`, `onKeyDown`, or `onKe
- L114 [js-set-map-lookups] This scales poorly because `array.includes()` inside a loop scans the whole list every time. Use a Set for constant-time

## src/features/terminal/components/session-tab.tsx
- L37 [unused-export] Unused export: `SessionKindGlyph` is exported but no module imports it, so it expands the public surface and can mislead
- L71 [unused-export] Unused export: `ConnStateDot` is exported but no module imports it, so it expands the public surface and can mislead cal

## src/features/api-keys/scope-picker.tsx
- L57 [js-set-map-lookups] This scales poorly because `array.includes()` inside a loop scans the whole list every time. Use a Set for constant-time

## src/features/edge-logs/components/edge-logs-view.tsx
- L67 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..

## src/features/logs/components/log-severity.ts
- L67 [no-new-array] Do not use `new Array(singleArgument)`.

## src/features/projects/components/new-resource/compose-wizard.tsx
- L68 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..

## src/features/projects/components/new-resource/wizard-chrome.tsx
- L125 [js-combine-iterations] This loops over your list twice because .map().filter() makes two passes, so do it in one pass with .reduce() or a for..

## src/features/projects/hooks/use-manifest-stage.ts
- L126 [no-unused-vars] Function 'useApplyManifestChange' is declared but never used.

## src/features/resources/components/postgres/tabs/data/components/snippet-tree.tsx
- L69 [no-unused-expressions] Expected expression to be used

## src/features/resources/components/service/tabs/settings/build-card-forms.tsx
- L192 [rerender-lazy-state-init] useState(map()) re-runs map() on every render & throws the result away.

## src/features/templates/components/template-arch-diagram.tsx
- L79 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..

## src/routes/_app/$orgSlug/-components/servers-managers-card.tsx
- L34 [js-tosorted-immutable] This wastes work because [...array].sort() copies the array just to sort it, so use array.toSorted() to sort without the

## src/routes/_app/$orgSlug/_shell/servers.tsx
- L85 [js-set-map-lookups] This scales poorly because `array.includes()` inside a loop scans the whole list every time. Use a Set for constant-time

## src/shared/components/data-grid/hooks/use-badge-overflow.ts
- L174 [no-unused-vars] Function 'clearBadgeWidthCache' is declared but never used.

## src/shared/components/ui/svgs/n8n.tsx
- L9 [rendering-svg-precision] Your users download extra bytes for SVG d precision they can't see, so round it to 1 or 2 decimals.

## src/shared/components/ui/svgs/vaultwarden.tsx
- L9 [rendering-svg-precision] Your users download extra bytes for SVG d precision they can't see, so round it to 1 or 2 decimals.
