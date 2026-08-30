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

import type { ResourceState } from "@/features/resources/lib/resource-state";

import { PanelIcon } from "@/features/resources/components/_shared/atoms";
import {
  ResourcePanelHeader,
  StatePill,
} from "@/features/resources/components/_shared/panel-header";
import { shortImageRef } from "@/shared/lib/image-ref";

import { HeaderActions, type HeaderResource, type PauseControl } from "./panel-header-actions";

export type { PauseControl };

export function ServicePanelHeader({
  resource,
  state,
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
  /** The service's ONE state (runtime-derived, see use-service-state). Null
   *  while genuinely unknown: the header then shows no pill rather than a
   *  guess. */
  state: ResourceState | null;
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
      status={state ? <StatePill state={state} /> : null}
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
