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

## src/routes/terminal.tsx
- L86 [no-impure-state-updater] This state updater performs the nested state update "setActiveId()". React may run updater functions more than once, so side effec
- L93 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/features/notifications/delivery-history-dialog.tsx
- L47 [exhaustive-deps] The following dependencies are missing in your queryKey: channel

## src/features/projects/hooks/use-project-events.ts
- L66 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/features/resources/components/postgres/tabs/data/use-data-studio-sql.ts
- L63 [no-pass-data-to-parent] Handing data back to a parent from a useEffect costs your users an extra render.

## src/features/webhooks/secret-reveal.tsx
- L34 [todo] This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the com

## src/shared/components/ui/tabs.tsx
- L175 [effect-needs-cleanup] `observe` creates a subscription in useLayoutEffect without returning cleanup. Return a cleanup function so it does not leak after
