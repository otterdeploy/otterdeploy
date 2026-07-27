/**
 * Live progress for a node enrollment.
 *
 * The enrollment row is the whole of what otterdeploy can observe about a
 * joining host: it is created here, marked redeemed when the host fetches its
 * one-time script, and completed when the host reports the swarm join back.
 * The install itself runs on the remote host over a connection we did not
 * open, so between redeem and completion there is genuinely nothing to
 * narrate — this says so instead of inventing sub-steps it cannot verify.
 *
 * Contrast ./server-provision-stepper, which drives off a live SSH log because
 * on that path otterdeploy is the one running the commands.
 */

import { Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Spinner } from "@/shared/components/ui/spinner";
import { formatDuration, useNowTick } from "@/shared/lib/duration";
import { cn } from "@/shared/lib/utils";

import type { JoinRole } from "./join-token-panel";

export type EnrollmentStatus = "active" | "expired" | "redeemed" | "completed" | "revoked";

/** The enrollment fields `server.enrollments` returns that bear on progress. */
export interface EnrollmentProgressRow {
  id: string;
  role: JoinRole;
  status: EnrollmentStatus;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  completedAt: string | null;
}

type StageState = "pending" | "active" | "done" | "failed";

interface Stage {
  key: string;
  label: string;
  state: StageState;
  /** Shown under the label — always a fact we hold, never a guess. */
  detail?: string;
}

export function computeEnrollmentStages(row: EnrollmentProgressRow, now: number): Stage[] {
  const { redeemedAt, completedAt } = row;
  const redeemed = redeemedAt != null;
  const completed = completedAt != null;
  const dead = row.status === "expired" || row.status === "revoked";

  const waitDetail = (() => {
    if (redeemedAt != null) {
      return `Host connected ${formatDuration(now - Date.parse(redeemedAt))} ago.`;
    }
    if (row.status === "revoked") return "Enrollment was revoked before the host ran it.";
    if (row.status === "expired") {
      return "Enrollment expired before the host ran it. Create a new one.";
    }
    const remaining = Date.parse(row.expiresAt) - now;
    return `Waiting for the host to run the command — expires in ${formatDuration(remaining)}.`;
  })();

  const installDetail = (() => {
    if (completedAt != null || redeemedAt == null) return undefined;
    if (row.status === "revoked") return "Revoked while the host was installing.";
    return `Running on the host for ${formatDuration(
      now - Date.parse(redeemedAt),
    )}. otterdeploy cannot see inside the host — it reports back when the join finishes.`;
  })();

  return [
    { key: "created", label: "Enrollment created", state: "done" },
    {
      key: "redeem",
      label: "Host runs the one-time command",
      state: redeemed ? "done" : dead ? "failed" : "active",
      detail: waitDetail,
    },
    {
      key: "install",
      label: `Host installs Docker and joins as ${row.role}`,
      state: completed
        ? "done"
        : !redeemed
          ? "pending"
          : row.status === "revoked"
            ? "failed"
            : "active",
      detail: installDetail,
    },
    {
      key: "joined",
      label: "Node joined the swarm",
      state: completed ? "done" : "pending",
      detail:
        completedAt != null
          ? `Completed in ${formatDuration(Date.parse(completedAt) - Date.parse(row.createdAt))}.`
          : undefined,
    },
  ];
}

function StageIcon({ state }: { state: StageState }) {
  if (state === "done")
    return <HugeiconsIcon icon={Tick02Icon} strokeWidth={2.5} className="size-4 text-foreground" />;
  if (state === "failed")
    return <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2.5} className="size-4 text-red-500" />;
  if (state === "active") return <Spinner className="size-4 text-foreground" />;
  return <span aria-hidden className="size-3 rounded-full ring-1 ring-foreground/25" />;
}

export function EnrollmentProgress({ row }: { row: EnrollmentProgressRow }) {
  const settled =
    row.status === "completed" || row.status === "expired" || row.status === "revoked";
  const now = useNowTick(!settled);
  const stages = computeEnrollmentStages(row, now);

  return (
    <ol className="flex flex-col gap-1" aria-live="polite">
      {stages.map((stage) => (
        <li key={stage.key} className="flex items-start gap-3 py-1">
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
            <StageIcon state={stage.state} />
          </span>
          <span className="flex flex-col gap-0.5">
            <span
              className={cn(
                "text-sm",
                stage.state === "pending" && "text-muted-foreground",
                stage.state === "failed" && "text-red-500",
              )}
            >
              {stage.label}
            </span>
            {stage.detail ? (
              <span
                className={cn(
                  "text-[11px] leading-relaxed",
                  stage.state === "failed" ? "text-red-500" : "text-muted-foreground",
                )}
              >
                {stage.detail}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
