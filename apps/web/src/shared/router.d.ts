import "@tanstack/react-router";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Human name for this route. Feeds breadcrumbs and the document title. */
    crumb?: string;
    /**
     * Excludes this route's crumb from the document title.
     *
     * For context that holds on *every* page and therefore says nothing about
     * where you are. The organization being the case in point. It stays
     * available to breadcrumbs, which do want the full trail.
     */
    ambientCrumb?: boolean;
    /**
     * Which tab this route is, from its tabbed layout down: `["logs"]`,
     * `["caddy", "certs", "custom"]`. A tab is a route rather than `?tab=`, so
     * it can be linked and reloaded; the layout reads the active one with
     * `useRouteView` (shared/hooks/use-route-view.ts) instead of keeping it
     * in state.
     */
    view?: readonly string[];
    /**
     * The project canvas opens its right-hand drawer for this route (a
     * resource or a preview). The canvas's index routes are children too and
     * must not open it.
     */
    drawer?: boolean;
    /**
     * This route can slide an overlay over its parent panel (the preview
     * deployment overlay). The parent keys its exit animation and its Escape
     * handling on it.
     */
    overlay?: boolean;
  }
}
