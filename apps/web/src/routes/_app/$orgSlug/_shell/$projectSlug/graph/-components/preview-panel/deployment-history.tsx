import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { badgeBase, label, pillClass, type PreviewService } from "./shared";

export function DeploymentHistory(props: {
  orgSlug: string;
  projectSlug: string;
  projectId: string;
  previewId: string;
  service: PreviewService;
}) {
  const { orgSlug, projectSlug, projectId, previewId, service } = props;
  const deployments = useQuery(
    orpc.project.resource.deployments.list.queryOptions({
      input: { projectId, resourceId: service.resourceId, previewId },
      refetchInterval: 5_000,
    }),
  );
  const rows = deployments.data ?? [];

  return (
    <div className="mb-6">
      <div className={label}>{service.serviceName}</div>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          {deployments.isLoading ? "Loading…" : "No preview deployments yet."}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
          {rows.map((d) => (
            <li key={d.id}>
              <Link
                to="/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId"
                params={{
                  orgSlug,
                  projectSlug: projectSlug as never,
                  resourceId: service.resourceId,
                  deploymentId: d.id,
                }}
                search={{ tab: "details", previewId }}
                className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50"
              >
                <span className={cn(badgeBase, pillClass(d.status))}>
                  <span className="size-1.5 rounded-full bg-current" />
                  {d.status}
                </span>
                <span className="font-mono text-[12px] text-muted-foreground">
                  {d.gitSha ? d.gitSha.slice(0, 7) : d.image.split(":").pop()?.slice(0, 12)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                  {d.reason}
                </span>
                <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground/70">
                  {new Date(d.createdAt).toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
