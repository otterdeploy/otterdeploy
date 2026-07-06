/**
 * Branching-pool section of the Server health card, plus the byte/usage
 * primitives it shares with the rest of the card. The pool is the ZFS
 * file-backed vdev the installer provisions for copy-on-write branch
 * databases: we show its fill level (when the host's zpool is readable) AND
 * what its sparse image file really costs the disk — the gap between the two
 * is what a trim hands back to the host.
 */

import { Button } from "@/shared/components/ui/button";
import { Progress } from "@/shared/components/ui/progress";

const GB = 1024 * 1024 * 1024;

export function fmtBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function UsageRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
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

/** Mirrors the system.hostHealth contract's branchPool block. */
export interface BranchPool {
  pool: string;
  health: string | null;
  sizeBytes: number | null;
  allocBytes: number | null;
  freeBytes: number | null;
  autotrim: boolean | null;
  imagePath: string | null;
  imageMaxBytes: number | null;
  imagePhysicalBytes: number | null;
  reclaimableBytes: number;
  suggestGrowBytes: number | null;
}

interface PoolActionProps {
  pool: BranchPool;
  reclaimPending: boolean;
  onTrim: () => void;
  growPending: boolean;
  onGrow: () => void;
}

function PoolActions({ pool, reclaimPending, onTrim, growPending, onGrow }: PoolActionProps) {
  return (
    <div className="flex gap-2">
      {pool.suggestGrowBytes != null && (
        <Button type="button" size="sm" variant="outline" disabled={growPending} onClick={onGrow}>
          {growPending ? "Growing…" : `Grow +${fmtBytes(pool.suggestGrowBytes)}`}
        </Button>
      )}
      {pool.reclaimableBytes > 0 && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={reclaimPending}
          onClick={onTrim}
        >
          {reclaimPending ? "Trimming…" : "Trim"}
        </Button>
      )}
    </div>
  );
}

export function BranchPoolBlock(props: PoolActionProps) {
  const { pool } = props;
  const pct =
    pool.sizeBytes && pool.allocBytes != null
      ? Math.round((pool.allocBytes / pool.sizeBytes) * 100)
      : null;
  const unhealthy = pool.health != null && pool.health !== "ONLINE";
  return (
    <div className="flex flex-col gap-1.5">
      {pct != null && pool.allocBytes != null && pool.sizeBytes != null ? (
        <UsageRow
          label="Branching pool"
          value={pct}
          detail={`${fmtBytes(pool.allocBytes)} / ${fmtBytes(pool.sizeBytes)} · ${pct}%${unhealthy ? ` · ${pool.health}` : ""}`}
        />
      ) : (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-medium">Branching pool</span>
          <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
            {unhealthy ? pool.health : "pool stats unavailable"}
          </span>
        </div>
      )}
      {pool.imagePhysicalBytes != null && pool.imageMaxBytes != null && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11.5px] text-muted-foreground">
            {fmtBytes(pool.imagePhysicalBytes)} on disk of a {fmtBytes(pool.imageMaxBytes)}{" "}
            ceiling
            {pool.reclaimableBytes > 0 && ` · ${fmtBytes(pool.reclaimableBytes)} reclaimable`}
          </span>
          <PoolActions {...props} />
        </div>
      )}
    </div>
  );
}
