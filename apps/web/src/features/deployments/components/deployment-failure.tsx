/**
 * Why a deploy failed, in the row itself, built from the app's own pieces: a
 * plain sentence (where it stopped, and what the resource kept serving), the
 * error set like a log line (level stripe, time, text), and the way to its
 * log. No red-filled strip: the status icon and word already carry the colour.
 */

import { File01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { deployStatusGroup } from "@otterdeploy/shared/deploy-status";

import { ErrorLogLine } from "@/features/resources/components/_shared/error-log-line";
import { Button } from "@/shared/components/ui/button";
import { CLOCK_SECONDS, clockFormatter } from "@/shared/lib/clock";
import { formatDuration } from "@/shared/lib/duration";

import type { ProjectDeployment, ServingDeployment } from "../data/deployments-search";

import { failedDuring, failureSentence } from "../model/deployments-view";

const atSeconds = clockFormatter(CLOCK_SECONDS);

export function FailureBlock({
  d,
  serving,
  onViewLogs,
}: {
  d: ProjectDeployment;
  serving: ServingDeployment | undefined;
  onViewLogs: () => void;
}) {
  if (d.status === "cancelled") {
    const took = d.completedAt ? Date.parse(d.completedAt) - Date.parse(d.createdAt) : null;
    return (
      <p className="text-[12.5px] text-foreground/80">
        Cancelled{took === null ? "" : " after "}
        {took === null ? null : <span className="font-mono">{formatDuration(took)}</span>}. Nothing
        was rolled out.
      </p>
    );
  }
  if (deployStatusGroup(d.status) !== "failed") return null;
  const { lead, kept } = failureSentence(d, serving);
  const at = d.completedAt ?? d.updatedAt;
  return (
    <div className="grid min-w-0 gap-2 @4xl:grid-cols-[minmax(0,1fr)_auto] @4xl:items-end @4xl:gap-x-4">
      <div className="min-w-0">
        <p className="text-[12.5px] text-foreground/80">
          {lead}
          {kept ? (
            <>
              {" "}
              <span className="font-mono text-[12px]">{kept.resource}</span> kept serving{" "}
              <span className="font-mono text-[12px]">{kept.ref}</span>.
            </>
          ) : null}
        </p>
        {d.errorMessage ? (
          <div
            className="mt-1.5 max-w-3xl rounded-md border bg-background px-2 py-1"
            title={d.errorMessage}
          >
            <ErrorLogLine
              ts={atSeconds(Date.parse(at))}
              text={d.errorMessage.split("\n", 1)[0] ?? d.errorMessage}
            />
          </div>
        ) : null}
      </div>
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="w-fit"
        onClick={(e) => {
          e.stopPropagation();
          onViewLogs();
        }}
      >
        <HugeiconsIcon icon={File01Icon} strokeWidth={2} />
        {d.status === "crashed" || failedDuring(d) === "deploy"
          ? "View deploy log"
          : "View build log"}
      </Button>
    </div>
  );
}
