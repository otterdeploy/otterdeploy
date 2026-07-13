# Wave C (effects & state) — bucket 2


## src/features/resources/components/postgres/tabs/data/use-data-studio.ts
- L148 [exhaustive-deps] React Hook useMemo has a missing dependency: 'tables'
- L149 [exhaustive-deps] `useMemo` can run with a stale `tables` & show your users old data.
- L185 [exhaustive-deps] React Hook useEffect has missing dependencies: 'tables', and 'openTable'
- L187 [no-chain-state-updates] Chaining state updates triggers an extra render each step.
- L189 [exhaustive-deps] `useEffect` can run with a stale `tables, openTable` & show your users old data.

## src/features/firewall/components/flagged-panel.tsx
- L46 [exhaustive-deps] `rows` is rebuilt every render, so `useMemo` runs every time.
- L46 [exhaustive-deps] React hook useMemo depends on `rows`, which changes every render

## src/features/terminal/components/terminal-session.tsx
- L120 [effect-needs-cleanup] `addEventListener` creates a subscription in a function that outlives the render, with no cleanup path. Store the handle and relea
- L125 [effect-needs-cleanup] `WebSocket` creates a connection in useEffect without returning cleanup. Return a cleanup function so it does not leak after unmou

## src/routes/terminal.tsx
- L86 [no-impure-state-updater] This state updater performs the nested state update "setActiveId()". React may run updater functions more than once, so side effec
- L93 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/features/logs/components/use-logs-table.ts
- L108 [no-chain-state-updates] Chaining state updates triggers an extra render each step.

## src/features/projects/components/stack/use-stack-state.ts
- L43 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with

## src/features/resources/components/postgres/tabs/data/studio-results.tsx
- L53 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with

## src/features/resources/components/service/tabs/settings/source-card.tsx
- L161 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with

## src/routes/_app/$orgSlug/_shell/docker.tsx
- L97 [no-unstable-deps] The result of useQuery is not referentially stable, so don't pass it directly into the dependencies array of useMemo. Instead, des

## src/shared/hooks/use-mobile.ts
- L14 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with
