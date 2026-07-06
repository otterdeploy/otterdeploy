/**
 * Server health card — introspection of the machine this install runs on:
 * memory (with swap awareness), disk at the data root, Docker's disk
 * footprint, and the recommendations the host-health monitor derives from
 * them (same code path server-side, so card and notifications always agree).
 * The reclaim actions are the safe prunes only — unused images, idle build
 * cache, stopped otterdeploy containers. Volumes are shown but never pruned
 * from here.
 */

import { Activity01Icon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Progress } from "@/shared/components/ui/progress";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { orpc, queryClient } from "@/shared/server/orpc";

type ReclaimTarget = "images" | "build-cache" | "containers";

const GB = 1024 * 1024 * 1024;

function fmtBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: "text-destructive ring-destructive/30",
  warning: "text-amber-600 ring-amber-500/30 dark:text-amber-500",
  info: "text-muted-foreground ring-border",
};

interface Recommendation {
  id: string;
  severity: string;
  title: string;
  detail: string;
  action: ReclaimTarget | null;
}

function RecommendationList({
  recommendations,
  pending,
  onReclaim,
}: {
  recommendations: Recommendation[];
  pending: boolean;
  onReclaim: (target: ReclaimTarget) => void;
}) {
  if (recommendations.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {recommendations.map((rec) => (
        <div
          key={rec.id}
          className={`flex flex-col gap-1 rounded-md p-3 ring-1 ${SEVERITY_STYLES[rec.severity] ?? SEVERITY_STYLES.info}`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12.5px] font-medium">{rec.title}</span>
            {rec.action && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => rec.action && onReclaim(rec.action)}
              >
                {pending ? "Reclaiming…" : "Reclaim"}
              </Button>
            )}
          </div>
          <span className="text-[11.5px] text-muted-foreground">{rec.detail}</span>
        </div>
      ))}
    </div>
  );
}

function UsageRow({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium">{label}</span>
        <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
          {detail}
        </span>
      </div>
      <Progress value={Math.min(100, value)} />
    </div>
  );
}

interface UsageSection {
  count: number;
  activeCount: number;
  totalBytes: number;
  reclaimableBytes: number;
}

/** Mirrors the system.hostHealth contract output. */
interface HostHealthData {
  memory: {
    totalBytes: number;
    availableBytes: number;
    usedPct: number;
    swapTotalBytes: number | null;
    swapFreeBytes: number | null;
  };
  disk: { path: string; totalBytes: number; freeBytes: number; usedPct: number } | null;
  docker: {
    images: UsageSection;
    containers: UsageSection;
    volumes: UsageSection;
    buildCache: UsageSection;
  } | null;
  recommendations: Recommendation[];
  sampledAt: string;
}

function HealthBody({
  health,
  pending,
  onReclaim,
}: {
  health: HostHealthData;
  pending: boolean;
  onReclaim: (targets: ReclaimTarget[]) => void;
}) {
  const dockerRows = health.docker
    ? ([
        ["Images", health.docker.images],
        ["Containers", health.docker.containers],
        ["Volumes", health.docker.volumes],
        ["Build cache", health.docker.buildCache],
      ] as const)
    : null;
  const reclaimable = health.docker
    ? health.docker.images.reclaimableBytes + health.docker.buildCache.reclaimableBytes
    : 0;
  const swapNote = health.memory.swapTotalBytes === 0 ? " · no swap" : "";

  return (
    <>
      <UsageRow
        label="Memory"
        value={health.memory.usedPct}
        detail={`${fmtBytes(health.memory.totalBytes - health.memory.availableBytes)} / ${fmtBytes(health.memory.totalBytes)} · ${health.memory.usedPct}%${swapNote}`}
      />
      {health.disk && (
        <UsageRow
          label={`Disk (${health.disk.path})`}
          value={health.disk.usedPct}
          detail={`${fmtBytes(health.disk.freeBytes)} free / ${fmtBytes(health.disk.totalBytes)} · ${health.disk.usedPct}%`}
        />
      )}

      {dockerRows ? (
        <div className="flex flex-col divide-y divide-border/60 rounded-md ring-1 ring-foreground/10">
          {dockerRows.map(([label, section]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <span className="text-[12.5px]">{label}</span>
              <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
                {section.count} · {fmtBytes(section.totalBytes)}
                {section.reclaimableBytes > 0 &&
                  ` (${fmtBytes(section.reclaimableBytes)} reclaimable)`}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[12.5px] text-muted-foreground">Docker disk usage unavailable.</div>
      )}

      <RecommendationList
        recommendations={health.recommendations}
        pending={pending}
        onReclaim={(target) => onReclaim([target])}
      />

      <div className="flex items-center justify-between gap-3">
        <span className="text-[11.5px] text-muted-foreground">
          {reclaimable > 0
            ? `${fmtBytes(reclaimable)} reclaimable across unused images and idle build cache.`
            : "Nothing significant to reclaim right now."}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || reclaimable === 0}
          onClick={() => onReclaim(["images", "build-cache", "containers"])}
        >
          {pending ? "Reclaiming…" : "Reclaim space"}
        </Button>
      </div>
    </>
  );
}

export function ServerHealthCard() {
  const query = useQuery({
    ...orpc.system.hostHealth.queryOptions(),
    refetchInterval: 60_000,
    retry: false,
  });
  const reclaim = useMutation({
    ...orpc.system.reclaim.mutationOptions(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: orpc.system.hostHealth.queryKey() });
      const failed = result.results.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast.error(`Reclaim partially failed: ${failed.map((f) => f.target).join(", ")}`);
      } else {
        toast.success(`Reclaimed ${fmtBytes(result.reclaimedBytes)}`);
      }
    },
    onError: (err) => toast.error(err.message ?? "Reclaim failed"),
  });

  const health = query.data;

  return (
    <SettingsSection
      icon={Activity01Icon}
      title="Server health"
      description="Memory, disk and Docker usage on the machine running this install — with one-click cleanup when old deploy images or build caches pile up."
    >
      <div className="flex flex-col gap-4 p-4">
        {query.isLoading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}
        {query.isError && (
          <div className="text-[12.5px] text-muted-foreground">
            Couldn't read host health{query.error?.message ? ` — ${query.error.message}` : ""}.
          </div>
        )}

        {health && (
          <HealthBody
            health={health}
            pending={reclaim.isPending}
            onReclaim={(targets) => reclaim.mutate({ targets })}
          />
        )}
      </div>
    </SettingsSection>
  );
}
