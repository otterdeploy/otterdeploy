import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { client } from "@/utils/orpc";

export const Route = createFileRoute("/containers")({
  component: RouteComponent,
});

function RouteComponent() {
  const query = useQuery({
    queryKey: ["docker-containers"],
    queryFn: () => client.docker.containers.list({ all: false }),
    refetchInterval: 5000,
  });

  return (
    <div className="row-span-2 h-full w-full overflow-y-auto p-6">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Containers</h1>
        <span className="text-xs text-muted-foreground">
          {query.isFetching ? "refreshing…" : `${query.data?.length ?? 0} running`}
        </span>
      </header>

      {query.error ? (
        <p className="text-sm text-destructive">
          {query.error.message ?? "Failed to load containers"}
        </p>
      ) : query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : query.data && query.data.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border">
          {query.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 p-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{c.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {c.image} · {c.status}
                </div>
              </div>
              <Link
                to="/terminal"
                search={{ container: c.id }}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
              >
                Open terminal
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No running containers.</p>
      )}
    </div>
  );
}
