import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/$project/")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/_dashboard/$project/"!</div>;
}
