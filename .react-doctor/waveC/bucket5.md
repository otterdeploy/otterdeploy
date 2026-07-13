# Wave C (effects & state) — bucket 5


## src/features/logs/data/use-log-stream.ts
- L59 [exhaustive-deps] React Hook useEffect contains a call to setState. Without a list of dependencies, this can lead to an infinite chain of updates.
- L61 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with
- L78 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

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

## src/features/api-keys/scope-picker.tsx
- L28 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/features/projects/components/new-resource/steps/source-pickers.tsx
- L113 [exhaustive-deps] `useEffect` can run with a stale `query.data.defaultBranch` & show your users old data.

## src/features/resources/components/_shared/metrics/use-resource-metrics.ts
- L143 [exhaustive-deps] `useMemo` can run with a stale `query.data.points` & show your users old data.

## src/features/resources/components/postgres/tabs/settings/danger-zone.tsx
- L28 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/features/webhooks/secret-reveal.tsx
- L34 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/shared/components/data-grid/data-grid-search.tsx
- L90 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with
