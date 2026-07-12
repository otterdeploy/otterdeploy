# Wave C (effects & state) — bucket 6


## src/features/projects/components/new-resource/overlay-provider.tsx
- L50 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with
- L52 [exhaustive-deps] `useEffect` can run with a stale `projectMatch.loaderData.project` & show your users old data.
- L67 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with
- L75 [exhaustive-deps] `useEffect` can run with a stale `projectMatch.loaderData.project` & show your users old data.

## src/features/projects/components/networking/caddyfile-viewer.tsx
- L47 [no-chain-state-updates] Chaining state updates triggers an extra render each step.
- L47 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with
- L51 [no-effect-chain] Your screen redraws several times from a single action because one useEffect changes "active", which sets off this one.

## src/features/logs/components/logs-histogram.tsx
- L49 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with
- L78 [prefer-use-effect-event] Your effect re-subscribes whenever "onSelectRange" changes, even though it's only used inside `addEventListener`.

## src/routes/_app/$orgSlug/_shell/terminal.tsx
- L57 [no-impure-state-updater] This state updater performs the nested state update "setActiveId()". React may run updater functions more than once, so side effec
- L64 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/features/logs/components/use-logs-table.ts
- L108 [no-chain-state-updates] Chaining state updates triggers an extra render each step.

## src/features/projects/components/stack/use-stack-state.ts
- L43 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with

## src/features/resources/components/postgres/tabs/data/use-data-studio-helpers.ts
- L74 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with

## src/features/volumes/remove-volume-dialog.tsx
- L55 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/shared/components/data-grid/data-grid-search.tsx
- L90 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with
