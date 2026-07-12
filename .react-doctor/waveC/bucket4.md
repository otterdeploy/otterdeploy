# Wave C (effects & state) — bucket 4


## src/features/resources/components/postgres/tabs/data/use-data-studio.ts
- L148 [exhaustive-deps] React Hook useMemo has a missing dependency: 'tables'
- L149 [exhaustive-deps] `useMemo` can run with a stale `tables` & show your users old data.
- L185 [exhaustive-deps] React Hook useEffect has missing dependencies: 'tables', and 'openTable'
- L187 [no-chain-state-updates] Chaining state updates triggers an extra render each step.
- L189 [exhaustive-deps] `useEffect` can run with a stale `tables, openTable` & show your users old data.

## src/features/resources/components/postgres/tabs/data/components/filter-popover.tsx
- L38 [no-event-handler] Faking an event handler with state plus a useEffect costs an extra render & runs late.
- L40 [no-chain-state-updates] Chaining state updates triggers an extra render each step.
- L40 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with

## src/features/terminal/components/terminal-session.tsx
- L120 [effect-needs-cleanup] `addEventListener` creates a subscription in a function that outlives the render, with no cleanup path. Store the handle and relea
- L125 [effect-needs-cleanup] `WebSocket` creates a connection in useEffect without returning cleanup. Return a cleanup function so it does not leak after unmou

## src/shared/components/ui/calendar.tsx
- L31 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com
- L32 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/features/projects/components/new-resource/steps/source-pickers.tsx
- L113 [exhaustive-deps] `useEffect` can run with a stale `query.data.defaultBranch` & show your users old data.

## src/features/resources/components/postgres/tabs/data/components/dice-grid.tsx
- L146 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with

## src/features/resources/components/service/tabs/settings/source-card.tsx
- L161 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with

## src/routes/_app/$orgSlug/settings/workspace/notifications.tsx
- L59 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com
