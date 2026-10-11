/**
 * What a command-based install looks like from the control plane.
 *
 * The enrollment row is the whole of what otterdeploy can observe about a
 * joining host: it is created here, marked redeemed when the host fetches its
 * one-time script, and completed when the host reports back. The install runs
 * on the remote host over a connection we did not open, so there is nothing to
 * time in between: "Joining" is simply the span between redeem and completion,
 * and it carries no time until the host reports. The host must already run
 * Docker; the command does not install it (the SSH path does).
 *
 * Contrast ./server-provision-stepper, which drives off a live SSH log because
 * on that path otterdeploy is the one running the commands.
 */

import { epochMsFromIso } from "@/shared/lib/clock";

import { clockSpan, type InstallStep } from "../add-server/install-step";

export type EnrollmentStatus = "active" | "expired" | "redeemed" | "completed" | "revoked";

/** The enrollment fields `server.enrollments` returns that bear on progress. */
export interface EnrollmentProgressRow {
  id: string;
  role: "worker" | "manager";
  status: EnrollmentStatus;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  completedAt: string | null;
}

/**
 * Where the Command tab is. `confirm` until a command exists; then the row
 * decides. An unredeemed command whose expiry has passed reads as expired at
 * once rather than waiting for the next poll to say so.
 */
export type CommandPhase = "confirm" | "ready" | "installing" | "connected" | "expired" | "revoked";

export function commandPhase(
  created: { expiresAt: string } | null,
  row: EnrollmentProgressRow | undefined,
  now: number,
): CommandPhase {
  if (!created) return "confirm";
  if (row?.completedAt) return "connected";
  if (row?.status === "revoked") return "revoked";
  if (row?.redeemedAt) return "installing";
  const expiresAt = epochMsFromIso(row?.expiresAt ?? created.expiresAt);
  if (row?.status === "expired" || (expiresAt !== null && now >= expiresAt)) return "expired";
  return "ready";
}

/** Milliseconds from the row's creation to `iso`, as `m:ss`. */
function since(row: EnrollmentProgressRow, iso: string | null): string | null {
  const start = epochMsFromIso(row.createdAt);
  const end = iso ? epochMsFromIso(iso) : null;
  return start === null || end === null ? null : clockSpan(end - start);
}

/** The four observable steps of a command-based install. */
export function enrollmentSteps(row: EnrollmentProgressRow): InstallStep[] {
  const ran = row.redeemedAt != null;
  const connected = row.completedAt != null;
  return [
    { key: "created", label: "Command created", state: "done", at: "0:00" },
    {
      key: "ran",
      label: "Server ran it",
      state: ran ? "done" : "active",
      at: since(row, row.redeemedAt),
    },
    {
      key: "join",
      label: "Joining",
      state: connected ? "done" : ran ? "active" : "pending",
      at: since(row, row.completedAt),
    },
    {
      key: "connected",
      label: "Connected",
      state: connected ? "done" : "pending",
      at: since(row, row.completedAt),
    },
  ];
}

/** How long the whole install took in ms, for the connected outcome. */
export function enrollmentTook(row: EnrollmentProgressRow): number | null {
  const start = epochMsFromIso(row.createdAt);
  const end = row.completedAt ? epochMsFromIso(row.completedAt) : null;
  return start === null || end === null ? null : end - start;
}
