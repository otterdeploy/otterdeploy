# Wave C (effects & state) — bucket 3


## src/features/edge-logs/components/edge-logs-view.tsx
- L60 [exhaustive-deps] `allRows` is rebuilt every render, so `useMemo` runs every time.
- L60 [exhaustive-deps] React hook useMemo depends on `allRows`, which changes every render
- L70 [exhaustive-deps] `allRows` is rebuilt every render, so `useMemo` runs every time.
- L70 [exhaustive-deps] React hook useMemo depends on `allRows`, which changes every render

## src/features/resources/components/postgres/tabs/data/components/filter-popover.tsx
- L37 [no-event-handler] Faking an event handler with state plus a useEffect costs an extra render & runs late.
- L39 [no-chain-state-updates] Chaining state updates triggers an extra render each step.
- L39 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with

## src/routes/_app/$orgSlug/_shell/$projectSlug/-components/variables-bulk-edit.tsx
- L83 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with
- L90 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with

## src/shared/components/data-grid/lib/compose-refs.ts
- L63 [exhaustive-deps] React Hook useCallback received a function whose dependencies are unknown.
- L63 [exhaustive-deps] `useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.

## src/features/notifications/delivery-history-dialog.tsx
- L47 [exhaustive-deps] The following dependencies are missing in your queryKey: channel

## src/features/projects/hooks/use-project-events.ts
- L66 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/features/resources/components/postgres/tabs/data/use-data-studio-helpers.ts
- L74 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with

## src/features/updates/components/update-progress.tsx
- L21 [no-fetch-in-effect] fetch() inside useEffect can race, double-fire, or leak. Use a data-fetching layer or Server Component instead.

## src/routes/_app/$orgSlug/settings/workspace/notifications.tsx
- L59 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com
