import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/")({
  component: HomeComponent,
});

function HomeComponent() {
  return <div className="grid h-svh grid-rows-[auto_1fr]">dsfdssfds</div>;
}
