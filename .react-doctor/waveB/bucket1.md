# Wave B — Agent bucket 1


## src/routes/_app/$orgSlug/-components/settings-email-fields.tsx
- L21 [label-has-associated-control] Screen reader users can't tell which input this label names because it's tied to none, so add `htmlFor` or wrap the inpu
- L45 [label-has-associated-control] Screen reader users can't tell which input this label names because it's tied to none, so add `htmlFor` or wrap the inpu
- L64 [label-has-associated-control] Screen reader users can't tell which input this label names because it's tied to none, so add `htmlFor` or wrap the inpu
- L103 [label-has-associated-control] Screen reader users can't tell which input this label names because it's tied to none, so add `htmlFor` or wrap the inpu
- L117 [label-has-associated-control] Screen reader users can't tell which input this label names because it's tied to none, so add `htmlFor` or wrap the inpu
- L132 [label-has-associated-control] Screen reader users can't tell which input this label names because it's tied to none, so add `htmlFor` or wrap the inpu
- L148 [label-has-associated-control] Screen reader users can't tell which input this label names because it's tied to none, so add `htmlFor` or wrap the inpu
- L163 [label-has-associated-control] Screen reader users can't tell which input this label names because it's tied to none, so add `htmlFor` or wrap the inpu

## src/features/projects/components/new-resource/steps/source.tsx
- L141 [label-has-associated-control] Screen reader users can't tell which input this label names because it's tied to none, so add `htmlFor` or wrap the inpu
- L153 [label-has-associated-control] Screen reader users can't tell which input this label names because it's tied to none, so add `htmlFor` or wrap the inpu

## src/routes/_app/$orgSlug/_shell/$projectSlug/-components/variables-bulk-edit.tsx
- L32 [async-await-in-loop] This makes the for…of loop slow because each await runs one after another, so collect the independent calls & run them t
- L81 [rerender-lazy-state-init] useState(new Set()) re-runs new Set() on every render & throws the result away.

## src/features/databases/shared.tsx
- L59 [unused-export] Unused export: `ProjectChip` is exported but no module imports it, so it expands the public surface and can mislead call

## src/features/git-providers/connect-dialog.tsx
- L33 [no-unused-vars] Identifier 'Spinner' is imported but never used.

## src/features/projects/components/new-resource/compose-wizard-fields.tsx
- L7 [no-unused-vars] Type 'ProjectId' is imported but never used.

## src/features/projects/components/new-resource/to-manifest.ts
- L88 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..

## src/features/projects/components/variables/reference-picker.tsx
- L150 [no-autofocus] `autoFocus` moves focus on load, which can disrupt screen reader and keyboard users. Remove it and let users choose wher

## src/features/resources/components/postgres/tabs/data/components/snippet-tree-rows.tsx
- L65 [control-has-associated-label] Blind users can't tell what this control does because screen readers find no label, so add visible text, `aria-label`, o

## src/features/resources/components/postgres/tabs/data/use-data-studio-helpers.ts
- L163 [async-await-in-loop] This makes the for…of loop slow because each await runs one after another, so collect the independent calls & run them t

## src/features/team/data/use-team.ts
- L136 [js-combine-iterations] This loops over your list twice because .filter().map() makes two passes, so do it in one pass with .reduce() or a for..

## src/routes/_app/$orgSlug/-components/audit-helpers.ts
- L79 [no-base-to-string] 'v ?? ""' will use Object's default stringification format ('[object Object]') when stringified.

## src/routes/_app/$orgSlug/_shell/docker.tsx
- L88 [no-rest-destructuring] Object rest destructuring on a query will observe all changes to the query, leading to excessive re-renders.

## src/shared/components/data-grid/direction.tsx
- L11 [no-unused-vars] Function 'DirectionProvider' is declared but never used.

## src/shared/components/ui/svgs/minio.tsx
- L9 [rendering-svg-precision] Your users download extra bytes for SVG d precision they can't see, so round it to 1 or 2 decimals.

## src/shared/components/ui/svgs/rust.tsx
- L6 [rendering-svg-precision] Your users download extra bytes for SVG d precision they can't see, so round it to 1 or 2 decimals.
