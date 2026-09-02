import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The landing used to live here while it was iterated on; it is now the home
 * page. Keep the path as a permanent redirect so shared /next links resolve.
 */
export const Route = createFileRoute("/next")({
  beforeLoad: () => {
    throw redirect({ to: "/", statusCode: 301 });
  },
});
