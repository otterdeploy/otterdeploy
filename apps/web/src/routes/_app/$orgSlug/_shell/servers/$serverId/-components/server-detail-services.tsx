/**
 * Services tab: what is placed on this box. The honest cross-project answer
 * today is `server.stats`: task count, reservations against capacity, and
 * which projects have work here. Named tasks live on each project's graph
 * (they are per-project queries), so this links there rather than pretending
 * to a fleet-wide task list the API does not have.
 */
import { Link } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";

import type { Server } from "@/features/servers/data/server";
import type { SwarmNode, SwarmNodesView } from "@/features/servers/data/swarm";
import type { ServerNodeStats } from "@/features/servers/detail/use-server-detail";

import { projectCollection } from "@/features/projects/data/project";
import { toProjectSlug } from "@/features/servers/detail/project-slug";
import { buttonVariants } from "@/shared/components/ui/button";
import { Meter } from "@/shared/components/ui/meter";
import { cn } from "@/shared/lib/utils";

import { KeyValueList, SectionCard } from "./server-detail-parts";
import { useEnvSlugResolver } from "@/features/shell/use-env-slug-resolver";
import { serverDisplayName } from "@/features/servers/detail/server-facts";

function Reservation({
  label,
  used,
  total,
  unit,
}: {
  label: string;
  used: number;
  total: number;
  unit: string;
}) {
  const known = total > 0;
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
          {known ? `${used} / ${total} ${unit}` : `${used} ${unit} reserved · capacity unknown`}
        </span>
      </div>
      {known && <Meter value={(used / total) * 100} label={`${label} reserved`} showValue={false} />}
    </div>
  );
}

function ProjectRows({
  slugs,
  orgSlug,
}: {
  slugs: readonly string[];
  orgSlug: string;
}) {
  const envSlugFor = useEnvSlugResolver();
  const { data: projects } = useLiveQuery((q) => q.from({ p: projectCollection }));
  const nameOf = (slug: string) => projects.find((p) => p.slug === slug)?.name ?? slug;
  return (
    <div className="flex flex-col divide-y">
      {slugs.map((slug) => {
        const branded = toProjectSlug(slug);
        return (
          <div key={slug} className="flex items-center gap-3 px-4 py-2.5 text-[12.5px]">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{nameOf(slug)}</div>
              <div className="truncate font-mono text-[11.5px] text-muted-foreground">{slug}</div>
            </div>
            {branded && (
              <>
                <Link
                  to="/$orgSlug/projects/$projectSlug/$envSlug/metrics"
                  params={{ orgSlug, projectSlug: branded, envSlug: envSlugFor({ projectSlug: slug }) }}
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 text-[12px]")}
                >
                  Metrics
                </Link>
                <Link
                  to="/$orgSlug/projects/$projectSlug"
                  params={{ orgSlug, projectSlug: branded }}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-[12px]")}
                >
                  Open project
                </Link>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function emptyPlacementCopy(isSwarm: boolean): string {
  return isSwarm
    ? "Nothing is scheduled on this server. Pin a service here from its Settings → Placement."
    : "Nothing runs on this server. On plain Docker every service runs on the control plane.";
}

export function ServerServicesTab({
  server,
  stats,
  node,
  swarmView,
  orgSlug,
}: {
  server: Server;
  stats: ServerNodeStats | null;
  node: SwarmNode | null;
  swarmView: SwarmNodesView | null;
  orgSlug: string;
}) {
  const isSwarm = swarmView?.swarm ?? false;
  return (
    <>
      {/* Reservations are swarm's: plain Docker sets limits, never
          reservations, so the numbers would read zero forever. */}
      {isSwarm ? (
      <SectionCard
        title={`Placed on ${serverDisplayName(server)}`}
        hint={`${stats?.tasksRunning ?? "–"} task${stats?.tasksRunning === 1 ? "" : "s"} scheduled here by swarm`}
      >
        {stats ? (
          <div className="grid grid-cols-1 gap-x-8 gap-y-3 px-4 py-3 sm:grid-cols-2">
            <Reservation label="CPU" used={stats.cpuAllocatedVcpu} total={server.cpuTotal} unit="vCPU" />
            <Reservation
              label="Memory"
              used={Math.round(stats.memoryAllocatedGb * 10) / 10}
              total={server.memTotalGb}
              unit="GB"
            />
          </div>
        ) : (
          <p className="px-4 py-3 text-[12.5px] text-muted-foreground">No placement data yet.</p>
        )}
      </SectionCard>
      ) : null}

      <SectionCard
        title="Projects with work here"
        hint="each project's canvas names its services"
      >
        {stats && stats.projects.length > 0 ? (
          <ProjectRows slugs={stats.projects} orgSlug={orgSlug} />
        ) : (
          <p className="px-4 py-3 text-[12.5px] text-muted-foreground">
            {emptyPlacementCopy(isSwarm)}
          </p>
        )}
      </SectionCard>

      {node && (
        <SectionCard title="Swarm node" hint="as the manager sees it">
          <KeyValueList
            className="py-1"
            items={[
              { label: "Node id", value: node.id },
              { label: "State", value: node.state },
              { label: "Availability", value: node.availability },
              { label: "Engine", value: node.engineVersion ?? "–" },
              { label: "Address", value: node.addr ?? "–" },
              { label: "Reachability", value: node.reachability ?? "–" },
            ]}
          />
        </SectionCard>
      )}
    </>
  );
}
