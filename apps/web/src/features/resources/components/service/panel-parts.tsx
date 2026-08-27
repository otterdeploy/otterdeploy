/**
 * Presentational pieces for {@link ServiceResourcePanel}, in a sibling module
 * so the panel component stays small: the header's service-specific parts.
 * The runtime action cluster lives in `panel-header-actions.tsx`.
 *
 * The status bar this file used to export is gone — state and the replica
 * summary ride the header's meta line now (see _shared/panel-header).
 */

import type { ReactNode } from "react";

import type { FrameworkKind } from "@/features/projects/components/framework-logo";
import type { PanelCrumb } from "@/features/resources/components/_shared/panel-breadcrumb";

import { PanelIcon } from "@/features/resources/components/_shared/atoms";
import {
  PanelStatusPill,
  ResourcePanelHeader,
} from "@/features/resources/components/_shared/panel-header";
import { shortImageRef } from "@/shared/lib/image-ref";

import { HeaderActions, type HeaderResource, type PauseControl } from "./panel-header-actions";

export type { PauseControl };

export function ServicePanelHeader({
  resource,
  status,
  framework,
  pending,
  crumb,
  onClose,
  onRestart,
  restarting,
  onBuild,
  building,
  pause,
  replicaLine,
}: {
  resource: HeaderResource;
  /** Resource-row status (`valid` / `draft` / `invalid`). Not on
   *  HeaderResource, which is only what the action cluster needs. */
  status: string;
  framework?: FrameworkKind | null;
  pending: boolean;
  crumb: PanelCrumb;
  onClose: () => void;
  onRestart: () => void;
  restarting: boolean;
  onBuild: (noCache?: boolean) => void;
  building: boolean;
  /** Null/undefined until the live service view is loaded (or pending mode). */
  pause?: PauseControl | null;
  /** Replica + public-domain summary, folded up out of the old status bar. */
  replicaLine?: ReactNode;
}) {
  return (
    <ResourcePanelHeader
      icon={
        <PanelIcon
          node={{
            kind: "service",
            name: resource.name,
            description: resource.image,
            framework,
            // Brand mark only for pulled images; a git/upload build's image
            // is an internal artifact ref with no brand identity.
            ...(resource.source === "image" ? { image: resource.image } : {}),
          }}
        />
      }
      name={resource.name}
      crumb={crumb}
      status={<ServiceStatusPill status={status} paused={pause?.paused === true} />}
      meta={
        <span title={resource.image}>
          {shortImageRef(resource.image)}
          {replicaLine}
        </span>
      }
      actions={
        // Runtime actions need a deployed service, omit them while the
        // service is still a staged create (Deploy from the pending bar).
        pending ? null : (
          <HeaderActions
            resource={resource}
            onRestart={onRestart}
            restarting={restarting}
            onBuild={onBuild}
            building={building}
            pause={pause}
          />
        )
      }
      onClose={onClose}
    />
  );
}

/**
 * Status for a service, folded out of the old bar.
 *
 * Paused is deliberately muted rather than destructive: it is an operator
 * choice, not a failure, and it must never wear the green a running service
 * has.
 */
function ServiceStatusPill({ status, paused }: { status: string; paused: boolean }) {
  if (paused) return <PanelStatusPill tone="paused" label="paused" />;
  const tone =
    status === "valid"
      ? "running"
      : status === "draft"
        ? "pending"
        : status === "invalid"
          ? "error"
          : "paused";
  // `valid`/`invalid`/`draft` is schema-speak. Say what the graph node says,
  // so a node and its panel read the same on the same screen.
  const label =
    status === "valid"
      ? "running"
      : status === "draft"
        ? "pending"
        : status === "invalid"
          ? "error"
          : status;
  return <PanelStatusPill tone={tone} label={label} />;
}
