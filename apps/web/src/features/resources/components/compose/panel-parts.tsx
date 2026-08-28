/**
 * Header + status helpers for {@link ComposeResourcePanel}, in a sibling
 * module so the panel component stays small. The content tabs live in
 * {@link ./panel-tabs}.
 *
 * The status bar this file used to export is gone: `2/2 RUNNING` now rides the
 * header's meta line (see _shared/panel-header), which is where the count sits
 * next to the name it counts instead of on a second full-width row that also
 * reprinted the stack name.
 */

import { RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { PanelCrumb } from "@/features/resources/components/_shared/panel-breadcrumb";

import { PanelIcon } from "@/features/resources/components/_shared/atoms";
import {
  PanelStatusPill,
  ResourcePanelHeader,
} from "@/features/resources/components/_shared/panel-header";
import { Button } from "@/shared/components/ui/button";

export type StackServiceStatus =
  | "running"
  | "building"
  | "deploying"
  | "error"
  | "offline"
  | "pending";

export interface ComposeService {
  name: string;
  /** Runtime name (`composeSwarmServiceName(stack, name)`): the join key back
   *  to this service's materialized child resource. The child's `name` is
   *  collision-suffixed and must never be used for the match. */
  serviceName: string;
  image: string | null;
  hasBuild: boolean;
  ports: number[];
  volumes: string[];
}

type DeploymentStatus =
  | "pending"
  | "building"
  | "starting"
  | "running"
  | "crashed"
  | "paused"
  | "failed"
  | "cancelled"
  | "superseded"
  | "removed"
  | null;

/** Build-time base before live tasks arrive. `building` means an actual image
 *  build; `pending`/`starting` mean the rollout is pulling/starting containers.
 *  Image-only stacks never build, so calling that phase "Building" was a
 *  lie. The two states render distinctly (Building vs Deploying). */
export function baseStatus(dep: DeploymentStatus): StackServiceStatus | undefined {
  switch (dep) {
    case "building":
      return "building";
    case "starting":
    case "pending":
      return "deploying";
    case "crashed":
    case "failed":
      return "error";
    case "running":
      return undefined;
    default:
      return dep == null ? "pending" : undefined;
  }
}

export function ComposePanelHeader({
  name,
  serviceCount,
  source,
  logoBrand,
  crumb,
  running,
  onClose,
  onRedeploy,
  redeploying,
  draft,
}: {
  name: string;
  serviceCount: number;
  source: "inline" | "git";
  logoBrand?: string | null;
  crumb: PanelCrumb;
  /** Rolled-up child state for the status pill: null while the stack is a
   *  staged create and nothing is running yet. */
  running: { up: number; total: number; anyError: boolean } | null;
  onClose: () => void;
  onRedeploy: () => void;
  redeploying: boolean;
  /** Staged create: nothing has deployed yet, so the action is Deploy and the
   *  in-flight state belongs to the apply, not to a redeploy. */
  draft: boolean;
}) {
  return (
    <ResourcePanelHeader
      icon={
        <PanelIcon
          node={{ kind: "compose", name, description: "", logoBrand: logoBrand ?? undefined }}
        />
      }
      name={name}
      crumb={crumb}
      status={running ? <ComposeStatusPill running={running} /> : null}
      // The stack's own name is the title directly above this line, so the
      // old status bar's copy of it is gone rather than moved.
      meta={
        <>
          Stack · {serviceCount} {serviceCount === 1 ? "service" : "services"} ·{" "}
          {source === "git" ? "from repo" : "inline file"}
        </>
      }
      actions={
        <ComposeDeployButton onRedeploy={onRedeploy} redeploying={redeploying} draft={draft} />
      }
      onClose={onClose}
    />
  );
}

/**
 * Deploy (staged create) or Redeploy (live stack), plus the in-flight state of
 * whichever one this is.
 *
 * `draft` and `redeploying` used to be the same prop. A staged stack passed
 * `pending` straight into `redeploying`, so it rendered a spinner reading
 * "Redeploying…" — on a stack that had never deployed — and `disabled` made
 * that the one control in the panel nobody could click. The two states are
 * separate now: a draft gets an enabled Deploy, and only a real in-flight
 * mutation disables anything.
 */
function ComposeDeployButton({
  onRedeploy,
  redeploying,
  draft,
}: {
  onRedeploy: () => void;
  redeploying: boolean;
  draft: boolean;
}) {
  const label = draft ? "Deploy" : "Redeploy";
  const busyLabel = draft ? "Deploying…" : "Redeploying…";
  return (
    <Button
      type="button"
      variant={draft ? "default" : "outline"}
      size="sm"
      onClick={onRedeploy}
      disabled={redeploying}
      aria-label={redeploying ? busyLabel : label}
    >
      <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
      {/* Label drops below `sm`: the icon carries it, and the row has to
          leave room for the stack name. */}
      <span className="hidden sm:inline">{redeploying ? busyLabel : label}</span>
    </Button>
  );
}

/** `2/2 running`, or `1/2 running` in destructive red when a child failed.
 *  Folded out of the old status bar: the count belongs next to the name it
 *  counts, not on a row of its own. */
function ComposeStatusPill({
  running,
}: {
  running: { up: number; total: number; anyError: boolean };
}) {
  const allRunning = running.up === running.total && running.total > 0;
  return (
    <PanelStatusPill
      tone={allRunning ? "running" : running.anyError ? "error" : "building"}
      label={`${running.up}/${running.total} running`}
    />
  );
}
