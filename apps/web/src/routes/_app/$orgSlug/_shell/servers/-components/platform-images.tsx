// Which build the install runs. The server, the build worker and the health
// agent are one image with different commands; a container on a different
// build than the server is version skew, and this is where it shows.
// Backed by system.platformImages (system-health/platform-image.ts).
import type { InferRouterOutputs } from "@orpc/server";
import type { AppRouter } from "@otterdeploy/api/routers/index";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/shared/components/ui/badge";
import { Card } from "@/shared/components/ui/card";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { orpc } from "@/shared/server/orpc";

type PlatformImages = InferRouterOutputs<AppRouter>["system"]["platformImages"];

const ROLE_LABEL: Record<PlatformImages["components"][number]["role"], string> = {
  server: "Server",
  builder: "Build worker",
  "health-agent": "Health agent",
};

export function PlatformImagesSection() {
  const q = useQuery({ ...orpc.system.platformImages.queryOptions(), refetchInterval: 60_000 });

  return (
    <section className="flex flex-col gap-3 border-b px-4 py-4 sm:px-6 sm:py-6">
      <div>
        <h2 className="text-sm font-semibold">Platform images</h2>
        <p className="text-xs text-muted-foreground">
          The image the server runs, and the install's containers on this host that run it.
        </p>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-28 w-full" />
      ) : q.isError ? (
        <ErrorState message="Couldn't read the platform images." onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <PlatformImagesBody data={q.data} />
      ) : null}
    </section>
  );
}

function PlatformImagesBody({ data }: { data: PlatformImages }) {
  const skewed = data.components.filter((c) => !c.matchesServer).length;

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Server image</dt>
        <dd className="truncate font-mono" title={data.server.image}>
          {data.server.image}
          {data.server.source === "configured" ? (
            <span className="ml-2 font-sans text-muted-foreground">
              (configured; the server is not running in a container)
            </span>
          ) : null}
        </dd>
        <dt className="text-muted-foreground">Reported version</dt>
        <dd className="font-mono">
          {data.version}
          {data.imageMatchesVersion ? null : (
            <span className="ml-2 font-sans text-muted-foreground">
              differs from the image's tag: the version is configuration, the image is what runs
            </span>
          )}
        </dd>
      </dl>

      {skewed > 0 ? (
        <p className="text-xs text-warning">
          {skewed === 1
            ? "1 container runs a different build than the server."
            : `${skewed} containers run a different build than the server.`}
        </p>
      ) : null}

      <Card className="min-w-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Container</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Image</th>
              <th className="px-3 py-2 text-right font-medium">Build</th>
            </tr>
          </thead>
          <tbody>
            {data.components.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  No platform containers found on this host's Docker daemon.
                </td>
              </tr>
            ) : (
              data.components.map((c) => (
                <tr key={c.name} className="border-b last:border-0">
                  <td className="px-3 py-2 font-mono text-[12.5px]">{c.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{ROLE_LABEL[c.role]}</td>
                  <td className="max-w-80 truncate px-3 py-2 font-mono text-[12.5px]" title={c.image}>
                    {c.image}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {c.matchesServer ? (
                      <span className="text-xs text-muted-foreground">same as server</span>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-warning/30 bg-warning/10 text-warning"
                      >
                        different build
                      </Badge>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
