# Wave C (effects & state) — bucket 4


## src/features/projects/components/new-resource/overlay-provider.tsx
- L50 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with
- L52 [exhaustive-deps] `useEffect` can run with a stale `projectMatch.loaderData.project` & show your users old data.
- L67 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with
- L75 [exhaustive-deps] `useEffect` can run with a stale `projectMatch.loaderData.project` & show your users old data.

## src/shared/components/data-grid/data-grid-row.tsx
- L181 [exhaustive-deps] `useCallback` can run with a stale `virtualItem.index` & show your users old data.
- L193 [exhaustive-deps] React Hook useMemo has unnecessary dependency: columnPinning
- L193 [exhaustive-deps] React Hook useMemo has unnecessary dependency: columnVisibility

## src/routes/_app/$orgSlug/_shell/$projectSlug/deployments.tsx
- L71 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with
- L75 [exhaustive-deps] `useMemo` can run with a stale `search.window` & show your users old data.

## src/shared/components/ui/calendar.tsx
- L31 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com
- L32 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/features/projects/components/networking/custom-config-editor.tsx
- L40 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with

## src/features/resources/components/_shared/metrics/use-project-metrics.ts
- L128 [exhaustive-deps] `useMemo` can run with a stale `query.data.points, query.data.bucketSeconds` & show your users old data.

## src/features/resources/components/postgres/tabs/data/use-data-studio-sql.ts
- L63 [no-pass-data-to-parent] Handing data back to a parent from a useEffect costs your users an extra render.

## src/features/volumes/remove-volume-dialog.tsx
- L55 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/shared/components/data-grid/data-grid-cell-wrapper.tsx
- L47 [exhaustive-deps] `useCallback` can run with a stale `tableMeta.cellMapRef` & show your users old data.
