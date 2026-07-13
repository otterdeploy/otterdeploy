# Wave C (effects & state) — bucket 1


## src/routes/_app/$orgSlug/_shell/audit.tsx
- L57 [exhaustive-deps] React Hook useMemo has a missing dependency: 'filter'
- L58 [exhaustive-deps] `useMemo` can run with a stale `filter` & show your users old data.
- L58 [exhaustive-deps] React Hook useMemo has unnecessary dependency: filter.action
- L58 [exhaustive-deps] React Hook useMemo has unnecessary dependency: filter.actor
- L58 [exhaustive-deps] React Hook useMemo has unnecessary dependency: filter.from
- L58 [exhaustive-deps] React Hook useMemo has unnecessary dependency: filter.limit
- L58 [exhaustive-deps] React Hook useMemo has unnecessary dependency: filter.outcome
- L58 [exhaustive-deps] React Hook useMemo has unnecessary dependency: filter.range
- L58 [exhaustive-deps] React Hook useMemo has unnecessary dependency: filter.targetType
- L58 [exhaustive-deps] React Hook useMemo has unnecessary dependency: filter.to

## src/shared/components/ui/sidebar.tsx
- L86 [exhaustive-deps] `useCallback` can run with a stale `openProp, _open` & show your users old data.
- L121 [exhaustive-deps] `useMemo` can run with a stale `openProp, _open` & show your users old data.

## src/features/projects/components/new-resource/steps/variables.tsx
- L52 [exhaustive-deps] `useEffect` can run with a stale `env.data.keys` & show your users old data.

## src/features/resources/components/postgres/tabs/data/components/dice-grid.tsx
- L149 [set-state-in-effect] This component misses React Compiler's automatic memoization & re-renders more than it should: Calling setState synchronously with

## src/features/resources/components/service/tabs/settings/danger-zone.tsx
- L34 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/routes/_app/$orgSlug/_shell/$projectSlug/logs.tsx
- L98 [prefer-use-effect-event] Your effect re-subscribes whenever "patchSearch" changes, even though it's only used inside `setTimeout`.

## src/shared/components/ui/tabs.tsx
- L175 [effect-needs-cleanup] `observe` creates a subscription in useLayoutEffect without returning cleanup. Return a cleanup function so it does not leak after
