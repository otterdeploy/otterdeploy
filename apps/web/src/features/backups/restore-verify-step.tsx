/**
 * The restore wizard's Verify stage: a server-side integrity check (the
 * server re-fetches the stored archive and recomputes its checksum against
 * the recorded one — a real probe, no fake diff) plus a plain source → target
 * summary built from what is genuinely stored on the run row.
 *
 * The check is a query keyed on the run id, so switching runs swaps verdicts
 * without any per-mount refetch — and re-opening the wizard on a run verified
 * moments ago reuses that result rather than making the server pull the whole
 * archive down again.
 */
import { Alert02Icon, CheckmarkCircle01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/shared/components/ui/badge";
import { orpc } from "@/shared/server/orpc";

import type { Backup, VerifyResult } from "./data/backups";
import type { RestoreMode } from "./restore-wizard-parts";

import { encLabel, fmtBytes } from "./shared";

export function VerifyStep({
  backup,
  mode,
  source,
}: {
  backup: Backup;
  mode: RestoreMode;
  source: string;
}) {
  const verify = useQuery({
    ...orpc.backups.verify.queryOptions({ input: { id: backup.id } }),
    // One shot, like the probe this replaces. An unreachable archive is a
    // verdict to show, not a blip worth three rounds of backoff — retrying
    // would only hold the badge on "re-fetching archive…" for seconds longer.
    retry: false,
    // The badge and the amber reason line carry the failure inline, so opt out
    // of the global error toast rather than reporting it twice.
    meta: { suppressErrorToast: true },
  });

  const result = verify.data ?? null;
  const error = verify.error ? verify.error.message || "Verification failed" : null;
  const checking = verify.isPending;

  return (
    <>
      <div className="rounded-md border bg-muted/30 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-semibold">Integrity check</span>
          <div className="flex-1" />
          <IntegrityBadge checking={checking} match={result?.match} />
        </div>
        <ChecksumLines backup={backup} result={result} error={error} />
      </div>

      <RestoreSummary backup={backup} mode={mode} source={source} />
    </>
  );
}

function IntegrityBadge({
  checking,
  match,
}: {
  checking: boolean;
  match: boolean | null | undefined;
}) {
  if (checking) {
    return (
      <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
        re-fetching archive…
      </Badge>
    );
  }
  if (match === true) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px] text-emerald-500"
      >
        <HugeiconsIcon icon={CheckmarkCircle01Icon} className="size-2.5" />
        checksum match
      </Badge>
    );
  }
  if (match === false) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-rose-500/30 bg-rose-500/10 font-mono text-[10px] text-rose-500"
      >
        <HugeiconsIcon icon={Alert02Icon} className="size-2.5" />
        checksum mismatch
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 border-amber-500/30 bg-amber-500/10 font-mono text-[10px] text-amber-500"
    >
      <HugeiconsIcon icon={Alert02Icon} className="size-2.5" />
      unverifiable
    </Badge>
  );
}

function ChecksumLines({
  backup,
  result,
  error,
}: {
  backup: Backup;
  result: VerifyResult | null;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-0.5 font-mono text-[11px] text-muted-foreground">
      <span className="break-all">stored: {result?.storedChecksum ?? backup.checksum ?? "—"}</span>
      {result?.computedChecksum && (
        <span className="break-all">computed: {result.computedChecksum}</span>
      )}
      <span>
        archive:{" "}
        {result?.archiveSizeBytes != null
          ? fmtBytes(result.archiveSizeBytes)
          : fmtBytes(backup.compressedSizeBytes)}{" "}
        at destination · encryption: {encLabel(backup.encryption)}
      </span>
      {(error ?? result?.reason) && (
        <span className="text-amber-500">{error ?? result?.reason}</span>
      )}
    </div>
  );
}

function RestoreSummary({
  backup,
  mode,
  source,
}: {
  backup: Backup;
  mode: RestoreMode;
  source: string;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 font-mono text-[11px] text-muted-foreground">
      <div>source: {backup.sourceService ?? source}</div>
      <div>target: {mode === "in-place" ? source : "(download only)"}</div>
      <div>size: {fmtBytes(backup.sourceSizeBytes)} raw</div>
      <div>method: {backup.method ?? "—"}</div>
      {mode === "in-place" && (
        <div className="text-rose-500">existing data on {source} will be replaced</div>
      )}
    </div>
  );
}
