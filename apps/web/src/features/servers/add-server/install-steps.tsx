/**
 * The two shapes an install takes on screen: the four-step list while it runs,
 * and one outcome block once it has an answer (connected, failed, expired).
 * Both ways in use the same pair, so a command install and an SSH install read
 * as the same job.
 */

import type { ReactNode } from "react";

import {
  AlertCircleIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";

import type { InstallStep, InstallStepState } from "./install-step";

/** Spoken alongside each icon, so state never rests on the glyph or its hue. */
const STATE_WORD: Record<InstallStepState, string> = {
  done: "done",
  active: "in progress",
  pending: "not started",
  failed: "failed",
};

function StepIcon({ state }: { state: InstallStepState }) {
  if (state === "done") {
    return <HugeiconsIcon icon={Tick02Icon} strokeWidth={2.5} className="size-4 text-success" />;
  }
  if (state === "failed") {
    return (
      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2.5} className="size-4 text-destructive" />
    );
  }
  if (state === "active") return <Spinner className="size-4 text-foreground" />;
  return <span aria-hidden className="size-1.5 rounded-full bg-foreground/25" />;
}

export function InstallSteps({ steps }: { steps: readonly InstallStep[] }) {
  return (
    <ol className="flex flex-col gap-2.5" aria-label="Install progress" aria-live="polite">
      {steps.map((step) => (
        <li
          key={step.key}
          data-state={step.state}
          className={cn(
            "grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2.5 text-sm",
            step.state === "active" && "font-medium",
            step.state === "pending" && "text-muted-foreground",
            step.state === "failed" && "text-destructive",
          )}
        >
          <span className="flex size-4 items-center justify-center">
            <StepIcon state={step.state} />
          </span>
          <span className="min-w-0">
            {step.label}
            <span className="sr-only">, {STATE_WORD[step.state]}</span>
          </span>
          {/* The time a step finished, from the start of the run. Labelled so
              the number is never left to guess at. */}
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {step.at ? (
              <>
                <span className="sr-only">at </span>
                {step.at}
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

type OutcomeTone = "ok" | "err" | "muted";

const OUTCOME_ICON = {
  ok: { icon: CheckmarkCircle02Icon, className: "text-success" },
  err: { icon: AlertCircleIcon, className: "text-destructive" },
  muted: { icon: Clock01Icon, className: "text-muted-foreground" },
} as const;

/** An icon, a bold line and one sentence. Failure is announced; the rest is status. */
export function Outcome({
  tone,
  title,
  children,
}: {
  tone: OutcomeTone;
  title: ReactNode;
  children: ReactNode;
}) {
  const { icon, className } = OUTCOME_ICON[tone];
  return (
    <div
      role={tone === "err" ? "alert" : "status"}
      className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-2.5"
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} className={cn("size-5", className)} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-semibold [overflow-wrap:anywhere]">{title}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
