import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/")({
  component: RouteComponent,

  beforeLoad: async ({ context }) => {
    throw redirect({ to: "/projects" });
  },
});

function RouteComponent() {
  return <div>Hello "/_dashboard/"!</div>;
}
