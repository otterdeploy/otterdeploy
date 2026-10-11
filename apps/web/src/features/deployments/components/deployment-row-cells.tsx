/**
 * The cells of one deploy row: status (icon, word, and what the word needs:
 * the step for a deploy in flight, "live since" for the one serving), the
 * change, who did it, and how long it took or has been running.
 */

import type { ReactNode } from "react";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { deployStatusGroup } from "@otterdeploy/shared/deploy-status";

import { Spinner } from "@/shared/components/ui/spinner";
import { formatDuration } from "@/shared/lib/duration";
import { cn } from "@/shared/lib/utils";

import type { ProjectDeployment } from "../data/deployments-search";

import { byLine, changeOf, inFlightStep, statusWord } from "../model/deployments-view";
import { ActorAvatar } from "./actor-avatar";
import { Clock } from "./deployment-time";

function StatusMark({ d }: { d: ProjectDeployment }) {
  const group = deployStatusGroup(d.status);
  if (group === "in-progress") return <Spinner className="size-3.5 text-warning" />;
  if (group === "failed") {
    return (
      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2.5} className="size-3.5 text-destructive" />
    );
  }
  return (
    <span className="grid size-3.5 place-items-center">
      <span
        className={cn(
          "size-2 rounded-full",
          d.isServing && d.status === "running"
            ? "bg-success"
            : "border-[1.5px] border-muted-foreground/45",
        )}
      />
    </span>
  );
}

export function StatusCell({ d, now }: { d: ProjectDeployment; now: number }) {
  const group = deployStatusGroup(d.status);
  const live = d.isServing && d.status === "running";
  const step = inFlightStep(d);
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "flex items-center gap-2 text-[12.5px] font-medium",
          live && "text-success",
          group === "in-progress" && "text-warning",
          group === "failed" && "text-destructive",
          !live && group === "settled" && "text-muted-foreground",
        )}
      >
        <StatusMark d={d} />
        {statusWord(d)}
      </div>
      {step ? (
        <div className="mt-1 flex items-center gap-2 pl-5.5 text-[11.5px] text-muted-foreground">
          <span aria-hidden className="flex gap-0.5">
            {Array.from({ length: step.of }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1 w-2.5 rounded-full",
                  i < step.step - 1
                    ? "bg-foreground/45"
                    : i === step.step - 1
                      ? "bg-warning"
                      : "bg-foreground/12",
                )}
              />
            ))}
          </span>
          <span>
            step <span className="font-mono text-foreground tabular-nums">{step.step}</span> of{" "}
            <span className="font-mono text-foreground tabular-nums">{step.of}</span>
          </span>
        </div>
      ) : null}
      {d.isServing && d.completedAt ? (
        <div className="mt-0.5 truncate pl-5.5 text-[11.5px] text-muted-foreground">
          {live ? "live since " : "current since "}
          <Clock iso={d.completedAt} now={now} className="text-muted-foreground" />
        </div>
      ) : null}
    </div>
  );
}

export function ChangeCell({
  d,
  expanded,
  detailId,
  onToggle,
}: {
  d: ProjectDeployment;
  expanded: boolean;
  detailId: string;
  onToggle: () => void;
}) {
  const c = changeOf(d);
  const bits: ReactNode[] = [];
  if (c.sha)
    bits.push(
      <span key="sha" className="font-mono text-foreground/80">
        {c.sha}
      </span>,
    );
  if (c.branch)
    bits.push(
      <span key="br" className="font-mono">
        {c.branch}
      </span>,
    );
  if (c.note) bits.push(<span key="note">{c.note}</span>);
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={detailId}
        className="flex max-w-full min-w-0 items-center gap-2 rounded-sm text-left text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {d.reason === "rollback" ? (
          <span className="shrink-0 rounded-sm bg-muted px-1.5 py-px text-[11px] font-normal text-muted-foreground">
            Rollback
          </span>
        ) : null}
        <span className={cn("truncate", c.titleMono && "font-mono text-[12.5px]")}>{c.title}</span>
      </button>
      {bits.length > 0 ? (
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-[11.5px] whitespace-nowrap text-muted-foreground">
          {bits.flatMap((b, i) =>
            i === 0
              ? [b]
              : [
                  <span key={`s${i}`} aria-hidden className="text-muted-foreground/50">
                    ·
                  </span>,
                  b,
                ],
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ByCell({ d }: { d: ProjectDeployment }) {
  const { actor, verb } = byLine(d);
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <ActorAvatar actor={actor} />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[12.5px] font-medium">
          {actor.kind === "person" ? actor.name : "Automatic"}
        </div>
        <div className="truncate text-[11.5px] text-muted-foreground">{verb}</div>
      </div>
    </div>
  );
}

export function TookCell({ d, now }: { d: ProjectDeployment; now: number }) {
  const inFlight = deployStatusGroup(d.status) === "in-progress";
  if (inFlight) {
    return (
      <div className="text-right">
        <span className="text-[11.5px] text-muted-foreground @4xl:hidden">elapsed </span>
        <span className="font-mono text-[12.5px] text-warning tabular-nums">
          {formatDuration(now - Date.parse(d.createdAt))}
        </span>
        <div className="hidden text-[11px] text-muted-foreground @4xl:block">elapsed</div>
      </div>
    );
  }
  const took = d.completedAt ? Date.parse(d.completedAt) - Date.parse(d.createdAt) : null;
  return (
    <div className="text-right">
      <span className="text-[11.5px] text-muted-foreground @4xl:hidden">took </span>
      <span className="font-mono text-[12.5px] tabular-nums">
        {took === null ? "–" : formatDuration(took)}
      </span>
    </div>
  );
}
