import { createFileRoute } from "@tanstack/react-router";

// `/servers`: the fleet page on its own. The layout (./layout.tsx) renders it;
// `/servers/new/*` renders the same page with the Add a server dialog over it.
export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/_fleet/")({});
