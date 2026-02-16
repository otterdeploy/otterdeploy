import { createFileRoute, redirect } from "@tanstack/react-router";

import { ArchitecturePage } from "@/components/architecture/architecture-page";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/project/$id")({
  component: RouteComponent,
  beforeLoad: async () => {
    const session = await authClient.getSession();

    if (!session.data) {
      redirect({
        to: "/login",
        throw: true,
      });
    }

    return { session };
  },
});

function RouteComponent() {
  const params = Route.useParams();

  return <ArchitecturePage projectId={params.id} />;
}
