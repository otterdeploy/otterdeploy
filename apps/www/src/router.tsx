import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import { NotFound } from "@/components/not-found";
import { ServerError } from "@/components/server-error";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createTanStackRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultNotFoundComponent: NotFound,
    // Without this, a throwing SSR route falls back to TanStack Start's
    // unstyled "Something went wrong!" boundary.
    defaultErrorComponent: ServerError,
  });
}
