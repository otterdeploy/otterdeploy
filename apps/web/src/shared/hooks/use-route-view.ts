/**
 * The tab path of the deepest route under the calling layout.
 *
 * Tabbed pages are nested routes: each tab is a child route that declares
 * `staticData: { view: [...] }`, and the layout renders the strip (and, for
 * most pages, the tab bodies) from that. Reading the deepest match means a
 * layout sees the full path: `/edge/certificates/custom` reports
 * `["caddy", "certs", "custom"]`, and the edge layout, the Caddy pane and the
 * certificates sub-tabs each take the level they own.
 *
 * Empty when no child declares one (the layout itself is the leaf).
 */
import { useChildMatches } from "@tanstack/react-router";

const NONE: readonly string[] = [];

export function useRouteView(): readonly string[] {
  const matches = useChildMatches();
  for (let i = matches.length - 1; i >= 0; i--) {
    const view = matches[i]?.staticData.view;
    if (view) return view;
  }
  return NONE;
}

/** One level of the active view, narrowed to a known tab union, or `fallback`. */
export function pickView<T extends string>(
  view: readonly string[],
  level: number,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = view[level];
  return allowed.find((tab) => tab === raw) ?? fallback;
}
