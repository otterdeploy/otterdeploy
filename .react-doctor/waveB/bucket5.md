# Wave B — Agent bucket 5


## src/features/resources/components/postgres/tabs/data/components/dice-grid.tsx
- L186 [async-await-in-loop] This makes the for…of loop slow because each await runs one after another, so collect the independent calls & run them t
- L89 [js-combine-iterations] This loops over your list twice because .map().filter() makes two passes, so do it in one pass with .reduce() or a for..
- L168 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..
- L183 [js-set-map-lookups] This scales poorly because `array.includes()` inside a loop scans the whole list every time. Use a Set for constant-time

## src/shared/components/data-grid/data-grid-cell-variants.tsx
- L519 [control-has-associated-label] Blind users can't tell what this control does because screen readers find no label, so add visible text, `aria-label`, o
- L1129 [js-flatmap-filter] This loops over your list twice because .map().filter(Boolean) makes two passes, so use .flatMap() to change & drop item
- L1876 [role-supports-aria-props] Screen reader users get no help from `aria-invalid` because role `region` ignores it, so remove it or change the role.
- L1877 [role-supports-aria-props] Screen reader users get no help from `aria-disabled` because role `region` ignores it, so remove it or change the role.

## src/features/templates/catalog/filter.ts
- L39 [js-tosorted-immutable] This wastes work because [...array].sort() copies the array just to sort it, so use array.toSorted() to sort without the
- L40 [js-tosorted-immutable] This wastes work because [...array].sort() copies the array just to sort it, so use array.toSorted() to sort without the

## src/features/account/sessions-card.tsx
- L29 [js-tosorted-immutable] This wastes work because [...array].sort() copies the array just to sort it, so use array.toSorted() to sort without the

## src/features/certificates/data/certificates.ts
- L49 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..

## src/features/firewall/components/flagged-panel.tsx
- L40 [js-combine-iterations] This loops over your list twice because .map().filter() makes two passes, so do it in one pass with .reduce() or a for..

## src/features/projects/components/networking/caddy-code-editor.tsx
- L134 [control-has-associated-label] Blind users can't tell what this control does because screen readers find no label, so add visible text, `aria-label`, o

## src/features/projects/components/new-resource/steps/source-pickers.tsx
- L52 [label-has-associated-control] Screen reader users can't tell which input this label names because it's tied to none, so add `htmlFor` or wrap the inpu

## src/features/projects/components/stack/yaml-editor.tsx
- L52 [control-has-associated-label] Blind users can't tell what this control does because screen readers find no label, so add visible text, `aria-label`, o

## src/features/resources/components/postgres/tabs/data/components/filter-popover.tsx
- L36 [no-unused-vars] Variable 'setNl' is declared but never used. Unused variables should start with a '_'.

## src/features/resources/components/postgres/tabs/data/studio-table-view.tsx
- L117 [js-hoist-intl] This is slow because new Intl.NumberFormat() rebuilds on every call inside a function, so move it to the top of the file

## src/features/shell/components/sidebar/index.tsx
- L22 [unused-export] Unused export: `StatusDot` is exported but no module imports it, so it expands the public surface and can mislead caller

## src/features/webhooks/shared.ts
- L23 [unused-export] Unused export: `hostOf` is exported but no module imports it, so it expands the public surface and can mislead callers a

## src/routes/_app/$orgSlug/_shell/$projectSlug/logs.tsx
- L65 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..

## src/shared/components/data-grid/data-grid-search.tsx
- L161 [prefer-tag-over-role] Screen reader users get more reliable semantics from `<search>` than `role="search"`, so use `<search>` instead.

## src/shared/components/ui/svgs/excalidraw.tsx
- L9 [rendering-svg-precision] Your users download extra bytes for SVG d precision they can't see, so round it to 1 or 2 decimals.

## src/shared/components/ui/svgs/plausible.tsx
- L9 [rendering-svg-precision] Your users download extra bytes for SVG d precision they can't see, so round it to 1 or 2 decimals.

## src/shared/server/orpc.ts
- L38 [unbound-method] Avoid referencing unbound methods which may cause unintentional scoping of `this`.
