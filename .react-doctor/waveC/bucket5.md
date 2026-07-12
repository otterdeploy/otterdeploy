# Wave C (effects & state) — bucket 5


## src/features/edge-logs/components/edge-logs-view.tsx
- L60 [exhaustive-deps] `allRows` is rebuilt every render, so `useMemo` runs every time.
- L60 [exhaustive-deps] React hook useMemo depends on `allRows`, which changes every render
- L70 [exhaustive-deps] `allRows` is rebuilt every render, so `useMemo` runs every time.
- L70 [exhaustive-deps] React hook useMemo depends on `allRows`, which changes every render

## src/features/logs/data/use-log-stream.ts
- L59 [exhaustive-deps] React Hook useEffect contains a call to setState. Without a list of dependencies, this can lead to an infinite chain of updates.
- L61 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with
- L78 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/features/firewall/components/flagged-panel.tsx
- L44 [exhaustive-deps] `rows` is rebuilt every render, so `useMemo` runs every time.
- L44 [exhaustive-deps] React hook useMemo depends on `rows`, which changes every render

## src/routes/_app/$orgSlug/_shell/$projectSlug/deployments.tsx
- L71 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with
- L75 [exhaustive-deps] `useMemo` can run with a stale `search.window` & show your users old data.

## src/features/api-keys/scope-picker.tsx
- L28 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/features/projects/components/new-resource/steps/variables.tsx
- L52 [exhaustive-deps] `useEffect` can run with a stale `env.data.keys` & show your users old data.

## src/features/resources/components/postgres/tabs/data/studio-results.tsx
- L53 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with

## src/features/updates/components/update-progress.tsx
- L21 [no-fetch-in-effect] fetch() inside useEffect can race, double-fire, or leak. Use a data-fetching layer or Server Component instead.

## src/shared/components/data-grid/data-grid-cell-wrapper.tsx
- L47 [exhaustive-deps] `useCallback` can run with a stale `tableMeta.cellMapRef` & show your users old data.
