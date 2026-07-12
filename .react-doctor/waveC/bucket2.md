# Wave C (effects & state) — bucket 2


## src/shared/components/data-grid/hooks/use-data-grid.ts
- L2073 [exhaustive-deps] React Hook useMemo has unnecessary dependency: columns
- L2073 [exhaustive-deps] A complex expression in `useMemo`'s dependency array hides the real value, so stale values can slip through.
- L2073 [exhaustive-deps] React Hook useMemo has a complex expression in the dependency array.
- L2073 [exhaustive-deps] A complex expression in `useMemo`'s dependency array hides the real value, so stale values can slip through.
- L2073 [exhaustive-deps] React Hook useMemo has a complex expression in the dependency array.
- L2092 [exhaustive-deps] A complex expression in `useMemo`'s dependency array hides the real value, so stale values can slip through.
- L2092 [exhaustive-deps] React Hook useMemo has a complex expression in the dependency array.
- L2985 [effect-needs-cleanup] `addEventListener` creates a subscription in useEffect without returning cleanup. Return a cleanup function so it does not leak af
- L3273 [exhaustive-deps] `useMemo` can run with a stale `rowVirtualizer.measureElement` & show your users old data.

## src/routes/_app/$orgSlug/_shell/$projectSlug/-components/variables-bulk-edit.tsx
- L76 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with
- L83 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with

## src/shared/components/ui/sidebar.tsx
- L86 [exhaustive-deps] `useCallback` can run with a stale `openProp, _open` & show your users old data.
- L121 [exhaustive-deps] `useMemo` can run with a stale `openProp, _open` & show your users old data.

## src/features/resources/components/_shared/metrics/use-project-metrics.ts
- L128 [exhaustive-deps] `useMemo` can run with a stale `query.data.points, query.data.bucketSeconds` & show your users old data.

## src/features/resources/components/postgres/tabs/settings/danger-zone.tsx
- L28 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/routes/_app/$orgSlug/_shell/$projectSlug/logs.tsx
- L98 [prefer-use-effect-event] Your effect re-subscribes whenever "patchSearch" changes, even though it's only used inside `setTimeout`.

## src/shared/hooks/use-mobile.ts
- L14 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with
