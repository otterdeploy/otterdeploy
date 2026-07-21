/**
 * Shared staged-deployment timeline — the Railway-style phase stepper the
 * mockup shows inside the resource Deployments tab. Renders the summary line
 * (title + total clock), each phase row (Initialization / Build / Deploy /
 * Post-deploy) with its state icon and inline failure detail + a jump to the
 * build logs, and a Diagnose row on failure.
 *
 * Rendered in otterdeploy tokens (the `--primary` blue is the one accent, not
 * Railway's purple). Per-phase timings and a real Diagnose come with the
 * persisted phase model + diagnose endpoint (bd od-y64.12 / od-y64.13); until
 * then the summary carries the one honest duration and Diagnose is a labelled
 * placeholder that points at the build logs.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";
import {
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import type {
  Phase,
  PhaseState,
  TimelineInput,
  Tone,
} from "./deployment-timeline-model";

import { buildTimeline } from "./deployment-timeline-model";
import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";

/** Total duration as a mm:ss clock ("00:10"), matching the mockup. */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const TONE_TEXT: Record<Tone, string> = {
  success: "text-success",
  failed: "text-destructive",
  active: "text-warning",
  neutral: "text-foreground/90",
};

const PHASE_TEXT: Record<PhaseState, string> = {
  done: "text-foreground/85",
  active: "text-warning",
  failed: "text-destructive",
  pending: "text-muted-foreground/55",
};

interface LinkCtx {
  orgSlug: string;
  projectSlug: ProjectSlug;
  resourceId: string;
  deploymentId: string;
}

export function DeploymentTimelineView({
  deployment,
  link,
}: {
  deployment: TimelineInput;
  link: LinkCtx;
}) {
  const { title, tone, phases, totalMs } = buildTimeline(deployment);
  return (
    <div className="divide-y divide-border/40">
      <div
        className={cn(
          "flex items-center justify-between gap-3 px-4 py-2.5",
          tone === "failed" && "bg-destructive/[0.05]",
        )}
      >
        <div className="flex items-center gap-2.5">
          <ToneIcon tone={tone} />
          <span className={cn("text-[13px] font-medium", TONE_TEXT[tone])}>{title}</span>
        </div>
        {totalMs != null && (
          <span className="font-mono text-[11.5px] text-muted-foreground tabular-nums">
            ({formatClock(totalMs)})
          </span>
        )}
      </div>
      {phases.map((phase) => (
        <PhaseRow key={phase.key} phase={phase} link={link} />
      ))}
      {tone === "failed" && <DiagnoseRow link={link} />}
    </div>
  );
}

function PhaseRow({ phase, link }: { phase: Phase; link: LinkCtx }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-2.5",
        phase.state === "failed" && "bg-destructive/[0.05]",
      )}
    >
      <span className="mt-px grid size-4 shrink-0 place-items-center">
        <PhaseIcon state={phase.state} />
      </span>
      <div className="min-w-0 flex-1">
        <span className={cn("text-[13px]", PHASE_TEXT[phase.state])}>{phase.label}</span>
        {phase.detail && (
          <div className="mt-1 flex flex-col gap-1">
            <div className="font-mono text-[11.5px] break-all whitespace-pre-wrap text-destructive/90">
              {phase.detail}
            </div>
            <Link
              to="/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId"
              params={{
                orgSlug: link.orgSlug,
                projectSlug: link.projectSlug,
                resourceId: link.resourceId,
                deploymentId: link.deploymentId,
              }}
              search={{ tab: "build-logs" }}
              className="inline-flex w-fit items-center gap-1 text-[11.5px] text-primary underline-offset-2 hover:underline"
            >
              View the build logs for more detail
              <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3" />
            </Link>
          </div>
        )}
      </div>
      {phase.state === "pending" && (
        <span className="shrink-0 text-[11px] text-muted-foreground/50">Not started</span>
      )}
    </div>
  );
}

/** Diagnose affordance. Honest placeholder until the diagnose endpoint lands
 *  (bd od-y64.13): it names the action and routes to the real build logs, the
 *  best failure signal we have today, rather than faking an AI result. */
function DiagnoseRow({ link }: { link: LinkCtx }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <HugeiconsIcon
          icon={InformationCircleIcon}
          strokeWidth={2}
          className="size-4 shrink-0 text-primary"
        />
        <span className="text-[13px] text-primary/90">
          Read the build logs to understand why this deployment failed.
        </span>
      </div>
      <Link
        to="/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId"
        params={{
          orgSlug: link.orgSlug,
          projectSlug: link.projectSlug,
          resourceId: link.resourceId,
          deploymentId: link.deploymentId,
        }}
        search={{ tab: "build-logs" }}
        className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        View build logs
      </Link>
    </div>
  );
}

function ToneIcon({ tone }: { tone: Tone }) {
  if (tone === "active") return <Spinner className="size-4 text-warning" />;
  if (tone === "failed")
    return (
      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2.5} className="size-4 text-destructive" />
    );
  if (tone === "success")
    return (
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        strokeWidth={2}
        className="size-4 text-success"
      />
    );
  return (
    <HugeiconsIcon
      icon={CheckmarkCircle02Icon}
      strokeWidth={2}
      className="size-4 text-muted-foreground"
    />
  );
}

function PhaseIcon({ state }: { state: PhaseState }) {
  if (state === "active") return <Spinner className="size-3.5 text-warning" />;
  if (state === "done")
    return (
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        strokeWidth={2}
        className="size-4 text-success"
      />
    );
  if (state === "failed")
    return (
      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2.5} className="size-3.5 text-destructive" />
    );
  return <span className="size-2.5 rounded-full border-[1.5px] border-muted-foreground/30" />;
}
