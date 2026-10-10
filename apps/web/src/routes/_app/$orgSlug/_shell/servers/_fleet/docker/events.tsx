import { createFileRoute } from "@tanstack/react-router";

// Docker › Events. The fleet layout (../../layout.tsx) renders the page and reads which
// section this is. Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/_fleet/docker/events")({
  staticData: { view: ["docker", "events"] },
});
