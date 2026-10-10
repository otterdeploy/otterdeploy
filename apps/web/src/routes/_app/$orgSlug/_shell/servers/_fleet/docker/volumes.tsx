import { createFileRoute } from "@tanstack/react-router";

// Docker › Volumes. The fleet layout (../../layout.tsx) renders the page and reads which
// section this is. Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/_fleet/docker/volumes")({
  staticData: { view: ["docker", "volumes"] },
});
