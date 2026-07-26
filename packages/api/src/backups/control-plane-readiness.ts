/**
 * Recovery-readiness classification for the whole-control-plane backup
 * (od-5j8.13) — answers "could I actually recover this install right now?"
 * as a small set of concrete, falsifiable signals rather than a vibe.
 *
 * Pure + side-effect free (same discipline as `./retention.ts`) so the
 * "never fake green" guarantee is enforceable in a unit test: every `ready`
 * verdict in the test suite is reached by satisfying every real signal, and
 * every signal has a test proving its absence alone is enough to pull the
 * verdict down. The router (`../routers/backups/control-plane-service.ts`)
 * is the only place that gathers the real signals (DB row + a live
 * destination reachability probe) and hands them to `classifyReadiness`.
 */

export type ReadinessLevel = "ready" | "degraded" | "not_ready";

export interface ControlPlaneReadinessInput {
  now: Date;
  /** Operator has turned on control-plane backups at all. */
  backupEnabled: boolean;
  /** A backup destination has been assigned (`platformSettings.controlPlaneBackupDestinationId`). */
  destinationConfigured: boolean;
  /** Live reachability probe of the configured destination. `null` = not yet
   *  checked (e.g. readiness was requested without a probe, or the probe
   *  itself errored in a way that isn't a clean true/false). Treated as a
   *  degraded signal, never as "reachable". */
  destinationReachable: boolean | null;
  /** The recovery key (see `../lib/recovery-key.ts`) has been generated and
   *  the operator has confirmed export (`confirmExported`). Generation alone
   *  is NOT enough — an unexported key that only exists as a fingerprint in
   *  the DB is exactly as useless on a dead server as no key at all. */
  recoveryKeyExportedAt: Date | null;
  /** Timestamp of the most recent run that reached `succeeded`, regardless
   *  of whether a LATER run then failed. */
  lastSuccessfulBackupAt: Date | null;
  /** Status + timestamp of the single most recent run attempt (may be a
   *  failure even when `lastSuccessfulBackupAt` is set). */
  mostRecentRunStatus: "succeeded" | "failed" | null;
  mostRecentRunAt: Date | null;
}

export interface ControlPlaneReadiness {
  level: ReadinessLevel;
  /** Human-readable reasons the verdict isn't `ready` — empty iff `ready`. */
  reasons: string[];
  /** Age of the last successful backup in hours, or `null` if there has
   *  never been one. Exposed so the UI can render "14h ago" itself. */
  lastBackupAgeHours: number | null;
}

/** A backup older than this is still usable but flagged — a nudge before it
 *  becomes an actual gap. */
const STALE_WARN_HOURS = 30;
/** Past this age, the platform stops claiming recovery works — an operator
 *  who hasn't backed up in 3+ days effectively has no current DR posture. */
const STALE_FAIL_HOURS = 96;

export function classifyControlPlaneReadiness(
  input: ControlPlaneReadinessInput,
): ControlPlaneReadiness {
  const reasons: string[] = [];
  let notReady = false;
  let degraded = false;

  const flagNotReady = (reason: string) => {
    notReady = true;
    reasons.push(reason);
  };
  const flagDegraded = (reason: string) => {
    degraded = true;
    reasons.push(reason);
  };

  if (!input.backupEnabled) {
    flagNotReady("control-plane backups are turned off");
  }

  if (!input.destinationConfigured) {
    flagNotReady("no off-host backup destination is configured");
  } else if (input.destinationReachable === false) {
    flagNotReady("the configured backup destination is not reachable");
  } else if (input.destinationReachable === null) {
    flagDegraded("backup destination reachability has not been verified recently");
  }

  if (!input.recoveryKeyExportedAt) {
    flagNotReady(
      "no recovery key has been exported — encrypted backups cannot be decrypted without it",
    );
  }

  let lastBackupAgeHours: number | null = null;
  if (!input.lastSuccessfulBackupAt) {
    flagNotReady("there has never been a successful control-plane backup");
  } else {
    lastBackupAgeHours =
      (input.now.getTime() - input.lastSuccessfulBackupAt.getTime()) / (1000 * 60 * 60);
    if (lastBackupAgeHours < 0) {
      // Clock skew / bad input — treat as unknown rather than negative-age "fresh".
      flagDegraded("last successful backup timestamp is in the future — check host clocks");
      lastBackupAgeHours = null;
    } else if (lastBackupAgeHours > STALE_FAIL_HOURS) {
      flagNotReady(
        `last successful backup was ${Math.floor(lastBackupAgeHours / 24)} day(s) ago — beyond the recovery-point objective`,
      );
    } else if (lastBackupAgeHours > STALE_WARN_HOURS) {
      flagDegraded(`last successful backup was ${Math.floor(lastBackupAgeHours)}h ago`);
    }
  }

  if (input.mostRecentRunStatus === "failed") {
    flagDegraded("the most recent backup attempt failed — a retry is due");
  }

  const level: ReadinessLevel = notReady ? "not_ready" : degraded ? "degraded" : "ready";
  return { level, reasons, lastBackupAgeHours };
}
