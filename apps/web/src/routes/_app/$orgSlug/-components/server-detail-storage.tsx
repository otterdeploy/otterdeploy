/**
 * Storage tab: every mount the host reported, Docker's footprint on it, and
 * the branching pool. Reclaim actions execute on the local docker socket, so
 * they are offered only for the control-plane host and only to install
 * admins; a remote box shows the same numbers read-only and says why
 * (docs/designs/otterd.md: remote reclaim is an otterd verb).
 */
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Server } from "@/features/servers/data/server";
import type { ServerState } from "@/features/servers/detail/server-state";
import type { HostHealth } from "@/features/servers/detail/use-server-detail";

import { formatBytes } from "@otterdeploy/shared/format";

import { hasReadings, isControlPlaneRow } from "@/features/servers/detail/server-state";
import { Button } from "@/shared/components/ui/button";
import { orpc, queryClient } from "@/shared/server/orpc";

import { FilesystemsTable, SectionCard } from "./server-detail-parts";
import { BranchPoolBlock, UsageRow } from "./servers-health-pool";

type ReclaimTarget = "images" | "build-cache" | "containers" | "branch-pool";

const DOCKER_ROWS = [
  ["Images", "images", "images"],
  ["Containers", "containers", "containers"],
  ["Volumes", "volumes", null],
  ["Build cache", "buildCache", "build-cache"],
] as const;

function useReclaim() {
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.system.hostHealth.queryKey() }),
      queryClient.invalidateQueries({ queryKey: orpc.server.health.queryKey() }),
    ]);
  const reclaim = useMutation({
    ...orpc.system.reclaim.mutationOptions(),
    onSuccess: async (result) => {
      await invalidate();
      const failed = result.results.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast.error(`Reclaim partially failed: ${failed.map((f) => f.target).join(", ")}`);
      } else {
        toast.success(`Reclaimed ${formatBytes(result.reclaimedBytes)}`);
      }
    },
    onError: (err) => toast.error(err.message || "Reclaim failed"),
  });
  const grow = useMutation({
    ...orpc.system.growBranchPool.mutationOptions(),
    onSuccess: async (result) => {
      await invalidate();
      if (result.ok) toast.success(`Pool ceiling raised by ${formatBytes(result.addedBytes)}`);
      else toast.error(result.reason);
    },
    onError: (err) => toast.error(err.message || "Grow failed"),
  });
  return { reclaim, grow };
}

function DockerUsage({
  docker,
  canReclaim,
  pending,
  onReclaim,
}: {
  docker: NonNullable<HostHealth["docker"]>;
  canReclaim: boolean;
  pending: boolean;
  onReclaim: (targets: ReclaimTarget[]) => void;
}) {
  const total = DOCKER_ROWS.reduce((acc, [, key]) => acc + docker[key].totalBytes, 0);
  const reclaimAll = DOCKER_ROWS.flatMap(([, key, target]) =>
    target !== null && docker[key].reclaimableBytes > 0 ? [target] : [],
  );
  return (
    <>
      <div className="flex flex-col divide-y">
        {DOCKER_ROWS.map(([label, key, target]) => {
          const section = docker[key];
          return (
            <div key={key} className="flex items-center gap-3 px-4 py-2.5 text-[12.5px]">
              <span className="w-24 shrink-0">{label}</span>
              <span className="min-w-0 flex-1 font-mono text-[11.5px] tabular-nums text-muted-foreground">
                {section.count} ({section.activeCount} in use) · {formatBytes(section.totalBytes)}
                {section.reclaimableBytes > 0 && (
                  <span className="text-foreground/80">
                    {" "}
                    · {formatBytes(section.reclaimableBytes)} reclaimable
                  </span>
                )}
              </span>
              {canReclaim && target !== null && section.reclaimableBytes > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={pending}
                  onClick={() => onReclaim([target])}
                >
                  Reclaim
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-[12px] text-muted-foreground">
        <span>{formatBytes(total)} on disk for Docker</span>
        {canReclaim && reclaimAll.length > 0 && (
          <Button type="button" size="sm" className="h-7" disabled={pending} onClick={() => onReclaim(reclaimAll)}>
            {pending ? "Reclaiming…" : "Reclaim everything safe"}
          </Button>
        )}
      </div>
    </>
  );
}

/** Older agents report only the data-root disk; show it as the one mount. */
function filesystemsOf(health: HostHealth): NonNullable<HostHealth["filesystems"]> | null {
  if (health.filesystems) return health.filesystems;
  if (!health.disk) return null;
  const { path, totalBytes, freeBytes, usedPct } = health.disk;
  return [{ device: "–", mountPoint: path, fsType: "–", totalBytes, freeBytes, usedPct }];
}

function reclaimHint(canReclaim: boolean, local: boolean): string {
  if (canReclaim) return "safe prunes only: nothing a running container references";
  if (local) return "reclaim needs an install administrator";
  return "read-only here: reclaim runs on the control-plane host until the node daemon lands";
}

export function ServerStorageTab({
  server,
  health,
  state,
  isInstallAdmin,
}: {
  server: Server;
  health: HostHealth | null;
  state: ServerState;
  isInstallAdmin: boolean;
}) {
  const { reclaim, grow } = useReclaim();
  const shown = hasReadings(state.kind) ? health : null;
  const local = isControlPlaneRow(server);
  const canReclaim = local && isInstallAdmin;
  const filesystems = shown ? filesystemsOf(shown) : null;
  if (!shown) {
    return (
      <SectionCard title="Storage">
        <p className="px-4 py-3 text-[12.5px] text-muted-foreground">
          Nothing to show while {server.name} is not reporting.
        </p>
      </SectionCard>
    );
  }

  return (
    <>
      <SectionCard title="Filesystems" hint="every mount the host reported">
        {filesystems ? (
          <FilesystemsTable filesystems={filesystems} dim={state.kind === "stale"} />
        ) : (
          <p className="px-4 py-3 text-[12.5px] text-muted-foreground">Not reported by this host.</p>
        )}
      </SectionCard>

      <SectionCard
        title="Docker on this host"
        hint={reclaimHint(canReclaim, local)}
      >
        {shown.docker ? (
          <DockerUsage
            docker={shown.docker}
            canReclaim={canReclaim}
            pending={reclaim.isPending}
            onReclaim={(targets) => reclaim.mutate({ targets })}
          />
        ) : (
          <p className="px-4 py-3 text-[12.5px] text-muted-foreground">Docker disk usage unavailable.</p>
        )}
      </SectionCard>

      {shown.branchPool && (
        <SectionCard title="Branching pool" hint="ZFS pool for copy-on-write database branches">
          <div className="px-4 py-3">
            {canReclaim ? (
              <BranchPoolBlock
                pool={shown.branchPool}
                reclaimPending={reclaim.isPending}
                onTrim={() => reclaim.mutate({ targets: ["branch-pool"] })}
                growPending={grow.isPending}
                onGrow={() => grow.mutate({})}
              />
            ) : shown.branchPool.sizeBytes && shown.branchPool.allocBytes != null ? (
              <UsageRow
                label={shown.branchPool.pool}
                value={(shown.branchPool.allocBytes / shown.branchPool.sizeBytes) * 100}
                detail={`${formatBytes(shown.branchPool.allocBytes)} / ${formatBytes(shown.branchPool.sizeBytes)}`}
              />
            ) : (
              <p className="text-[12.5px] text-muted-foreground">Pool stats unavailable.</p>
            )}
          </div>
        </SectionCard>
      )}
    </>
  );
}
