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
  if (!raw) return fallback;
  return allowed.find((tab) => tab === raw) ?? fallback;
}

/**
 * The scrolling tab body inside a resource detail panel.
 *
 * The bottom padding lives HERE — on the one wrapper every `TabsContent` sits
 * inside — rather than on the tabs themselves, so a tab cannot ship without it.
 * Per-tab was the old arrangement and it drifted: fifteen tab bodies across the
 * three panels carried five different `pb-*` values, and the Compose tab's
 * Reset/Save row still ended up flush against the panel's bottom edge with
 * nothing under it. One owner, every tab, including ones not written yet.
 */
export const PANEL_TAB_BODY_CLASS = "relative pb-12";
