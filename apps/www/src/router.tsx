import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import { NotFound } from "@/components/not-found";
import { ServerError } from "@/components/server-error";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createTanStackRouter({
    routeTree,
    // URLs and robots.txt path rules are case-sensitive. Treating `/API/*`
    // as `/api/*` would let a mixed-case copy resolve even though crawlers
    // only see the canonical lower-case path in our disallow rules.
    caseSensitive: true,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultNotFoundComponent: NotFound,
    // Without this, a throwing SSR route falls back to TanStack Start's
    // unstyled "Something went wrong!" boundary.
    defaultErrorComponent: ServerError,
  });
}
