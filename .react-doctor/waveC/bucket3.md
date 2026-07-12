# Wave C (effects & state) — bucket 3


## src/shared/components/data-grid/data-grid-cell-variants.tsx
- L1030 [no-impure-state-updater] This state updater performs the captured value "newValues". React may run updater functions more than once, so side effects here c
- L1049 [no-impure-state-updater] This state updater performs the captured value "newValues". React may run updater functions more than once, so side effects here c
- L1110 [no-impure-state-updater] This state updater performs the captured value "newValues". React may run updater functions more than once, so side effects here c
- L1414 [exhaustive-deps] `useMemo` can run with a stale `fileCellOpts.accept` & show your users old data.
- L1585 [exhaustive-deps] `useCallback` can run with a stale `isUploading, isDeleting, fileCellOpts.maxFiles` & show your users old data.
- L1631 [exhaustive-deps] `useCallback` can run with a stale `isUploading, isDeleting` & show your users old data.
- L1663 [exhaustive-deps] `useCallback` can run with a stale `isUploading, isDeleting` & show your users old data.

## src/shared/components/data-grid/data-grid-row.tsx
- L181 [exhaustive-deps] `useCallback` can run with a stale `virtualItem.index` & show your users old data.
- L193 [exhaustive-deps] React Hook useMemo has unnecessary dependency: columnPinning
- L193 [exhaustive-deps] React Hook useMemo has unnecessary dependency: columnVisibility

## src/shared/components/data-grid/lib/compose-refs.ts
- L63 [exhaustive-deps] React Hook useCallback received a function whose dependencies are unknown.
- L63 [exhaustive-deps] `useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.

## src/features/projects/components/networking/custom-config-editor.tsx
- L40 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with

## src/features/resources/components/_shared/metrics/use-resource-metrics.ts
- L143 [exhaustive-deps] `useMemo` can run with a stale `query.data.points` & show your users old data.

## src/features/resources/components/service/tabs/settings/danger-zone.tsx
- L34 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/routes/_app/$orgSlug/_shell/docker.tsx
- L89 [no-unstable-deps] The result of useQuery is not referentially stable, so don't pass it directly into the dependencies array of useMemo. Instead, des
