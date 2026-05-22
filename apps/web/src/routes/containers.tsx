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
        <span className="text-muted-foreground text-xs">
          {query.isFetching ? "refreshing…" : `${query.data?.length ?? 0} running`}
        </span>
      </header>

      {query.error ? (
        <p className="text-destructive text-sm">
          {query.error.message ?? "Failed to load containers"}
        </p>
      ) : query.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : query.data && query.data.length > 0 ? (
        <ul className="divide-border divide-y rounded-md border">
          {query.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 p-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{c.name}</div>
                <div className="text-muted-foreground truncate text-xs">
                  {c.image} · {c.status}
                </div>
              </div>
              <Link
                to="/terminal"
                search={{ container: c.id }}
                className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium"
              >
                Open terminal
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No running containers.</p>
      )}
    </div>
  );
}
