import { createFileRoute, useLoaderData } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$orgSlug/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">{organization.name}</h1>
      <p className="text-sm text-muted-foreground">
        Projects will list here once project data is wired (out of scope).
      </p>
    </div>
  );
}
