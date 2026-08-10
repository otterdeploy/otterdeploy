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
  }
}
