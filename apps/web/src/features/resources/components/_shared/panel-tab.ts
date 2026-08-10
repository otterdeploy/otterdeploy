/**
 * Shared tab resolution for the resource detail panels.
 *
 * The `?tab=` search param on /graph/$resourceId is the source of truth for
 * which panel tab is open, so a panel is a *controlled* component: it derives
 * its active tab from the URL and reports clicks back up. That is what makes a
 * tab reloadable, shareable and reachable by back/forward.
 *
 * Each panel kind owns its own tab union, its own default, and its own subset
 * of tabs that work while the resource is still a staged ghost, so they pass
 * those in rather than this module knowing about them.
 */

/**
 * The panel tab named by the URL, or `fallback` when the URL names nothing
 * usable.
 *
 * Anything outside `allowed` falls back rather than rendering an empty panel:
 * a hand-edited URL, a link from an older build, or a runtime tab (logs,
 * metrics, terminal) named while the resource is a staged ghost with no
 * container to point at.
 */
export function resolvePanelTab<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return fallback;
}
