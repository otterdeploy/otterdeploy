/**
 * Trust panels for one backup run inside the detail drawer:
 *   - Verification: restore-proving verification history + a "Verify now"
 *     action (sandbox restore; the badge on the row tracks the latest verdict).
 *   - Restores: the run's restore history (mode, target, outcome, duration).
 * Both read their own on-demand queries, so the drawer stays cheap to open.
 */
import { useState } from "react";

import { ShieldEnergyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { errorFromUnknown } from "@otterdeploy/shared/promise";
import { useQuery } from "@tanstack/react-query";
import { Result } from "better-result";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { Backup, VerificationRow } from "./data/backups";

import { verifyRestore } from "./data/backups";
import { fmtBytes, fmtDuration, relTime } from "./shared";

function checksNumber(checks: VerificationRow["checks"], key: string): number | null {
  const v = checks?.[key];
  return typeof v === "number" ? v : null;
}

export function VerificationSection({ backup }: { backup: Backup }) {
  const [starting, setStarting] = useState(false);
  const key = orpc.backups.verifications.queryOptions({ input: { id: backup.id } });
  const { data: rows = [], isLoading } = useQuery({ ...key, enabled: backup.kind === "database" });

  if (backup.kind !== "database") return null;

  const startVerification = async () => {
    setStarting(true);
    const started = await Result.tryPromise({
      try: async () => {
        await verifyRestore(backup.id);
        await queryClient.invalidateQueries({ queryKey: key.queryKey });
      },
      catch: errorFromUnknown,
    });
    if (started.isErr()) toast.error(started.error.message);
    else toast.success("Verification started: restoring the snapshot into a sandbox");
    setStarting(false);
  };

  return (
    <div className="mb-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          Verification
        </span>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="h-6 gap-1 px-2 text-[11px]"
          disabled={backup.status !== "succeeded" || starting}
          onClick={startVerification}
        >
          <HugeiconsIcon icon={ShieldEnergyIcon} className="size-3" />
          Verify by restoring
        </Button>
      </div>
      {isLoading ? (
        <div className="text-[11px] text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Never verified. A verification restores this snapshot into a throwaway container and
          checks the result, proof the backup restores, not just that it's stored.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border bg-background">
          {rows.map((v, i) => (
            <VerificationRowView key={v.id} row={v} first={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function VerificationRowView({ row, first }: { row: VerificationRow; first: boolean }) {
  const tables = checksNumber(row.checks, "tableCount");
  const size = checksNumber(row.checks, "restoredSizeBytes");
  const tone =
    row.status === "passed"
      ? "text-success"
      : row.status === "failed"
        ? "text-destructive"
        : "text-info";
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 ${first ? "" : "border-t"}`}
    >
      <span className={`font-mono text-[11px] font-medium ${tone}`}>{row.status}</span>
      <span className="font-mono text-[11px] text-muted-foreground">{relTime(row.createdAt)}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{row.trigger}</span>
      {tables != null && (
        <span className="font-mono text-[11px] text-foreground/80">{tables} tables</span>
      )}
      {size != null && (
        <span className="font-mono text-[11px] text-foreground/80">{fmtBytes(size)} restored</span>
      )}
      {row.durationMs != null && (
        <span className="font-mono text-[11px] text-muted-foreground">
          {fmtDuration(row.durationMs)}
        </span>
      )}
      {row.failMessage && (
        <span
          className="w-full truncate font-mono text-[11px] text-destructive"
          title={row.failMessage}
        >
          {row.failMessage}
        </span>
      )}
    </div>
  );
}

export function RestoreHistorySection({ backup }: { backup: Backup }) {
  const { data: rows = [], isLoading } = useQuery({
    ...orpc.backups.restores.queryOptions({ input: { id: backup.id } }),
  });

  if (isLoading || rows.length === 0) return null;

  return (
    <div className="mb-3 flex flex-col gap-1.5">
      <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        Restores · {rows.length}
      </span>
      <div className="overflow-hidden rounded-md border bg-background">
        {rows.map((r, i) => (
          <div
            key={r.id}
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 ${i === 0 ? "" : "border-t"}`}
          >
            <span
              className={`font-mono text-[11px] font-medium ${
                r.status === "succeeded"
                  ? "text-success"
                  : r.status === "failed"
                    ? "text-destructive"
                    : "text-info"
              }`}
            >
              {r.status}
            </span>
            <span className="font-mono text-[11px] text-foreground/80">{r.mode}</span>
            {r.targetResourceId && (
              <span className="font-mono text-[10px] text-muted-foreground">
                → {r.targetResourceId}
              </span>
            )}
            <span className="font-mono text-[11px] text-muted-foreground">
              {relTime(r.startedAt)}
            </span>
            {r.durationMs != null && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {fmtDuration(r.durationMs)}
              </span>
            )}
            {r.errorMessage && (
              <span
                className="w-full truncate font-mono text-[11px] text-destructive"
                title={r.errorMessage}
              >
                {r.errorMessage}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
