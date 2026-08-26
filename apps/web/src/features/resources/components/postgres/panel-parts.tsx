/**
 * Presentational pieces for {@link RealResourcePanel}, in a sibling module so
 * the panel component stays small: the header's database-specific parts and
 * the engine-specific data-browser switch.
 *
 * The status bar this file used to export is gone — runtime state rides the
 * header's meta line now (see _shared/panel-header), next to the name it
 * describes rather than on a second full-width row.
 */

import type { ReactNode } from "react";

import { RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { PanelCrumb } from "@/features/resources/components/_shared/panel-breadcrumb";

import { PanelIcon } from "@/features/resources/components/_shared/atoms";
import { UnsupportedDataViewer } from "@/features/resources/components/_shared/data/unsupported-data-viewer";
import {
  PanelStatusPill,
  ResourcePanelHeader,
} from "@/features/resources/components/_shared/panel-header";
import { MariadbDataTabBody } from "@/features/resources/components/mariadb/tabs/data";
import { MongoDataTabBody } from "@/features/resources/components/mongo/tabs/data";
import { RedisDataTabBody } from "@/features/resources/components/redis/tabs/data";
import { Button } from "@/shared/components/ui/button";

import type { PostgresBodyProps } from "./types";

import { DataTabBody } from "./tabs/data";

type DbResource = PostgresBodyProps["resource"];

export function DatabasePanelHeader({
  resource,
  pending,
  crumb,
  onClose,
  onRestart,
  restarting,
  canRestart = true,
  metaTrailing,
}: {
  resource: DbResource;
  pending: boolean;
  crumb: PanelCrumb;
  onClose: () => void;
  onRestart: () => void;
  restarting: boolean;
  /** False for a database inside a shared server: it owns no container, so
   *  there is nothing here that could be restarted without restarting its
   *  neighbours. */
  canRestart?: boolean;
  /** Live connections chip (postgres only): information, not an action, so it
   *  rides the meta line rather than the button cluster. */
  metaTrailing?: ReactNode;
}) {
  return (
    <ResourcePanelHeader
      icon={
        <PanelIcon
          node={{
            kind: "database",
            name: resource.name,
            description: "",
            engine: resource.engine,
          }}
        />
      }
      name={resource.name}
      crumb={crumb}
      status={
        pending ? (
          <PanelStatusPill tone="pending" label="pending" />
        ) : (
          <DatabaseStatusPill
            runtime={resource.runtime}
            latestDeploymentStatus={resource.latestDeploymentStatus}
          />
        )
      }
      meta={
        <>
          {resource.engine}
          {!pending && (
            <>
              {" "}
              <span className="text-muted-foreground/50">·</span> {resource.databaseName}
            </>
          )}
        </>
      }
      metaTrailing={metaTrailing}
      actions={
        // Restart needs a running container of its own. Omitted while the
        // database is a staged create (Deploy from the pending bar), and for
        // one inside a shared server (see canRestart).
        !pending && canRestart ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRestart}
            disabled={restarting}
            aria-label={restarting ? "Restarting" : "Restart"}
          >
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
            {/* Label drops below `sm`. The icon carries it, and the row has to
                leave room for the resource name. */}
            <span className="hidden sm:inline">{restarting ? "Restarting…" : "Restart"}</span>
          </Button>
        ) : null
      }
      onClose={onClose}
    />
  );
}

/**
 * The pill that used to be the status bar's whole left half.
 *
 * A container that's missing/stopped while a deploy is in flight isn't broken:
 * the image is still pulling or docker hasn't created it yet. That window says
 * "deploying" rather than wearing a scary MISSING badge.
 */
export function DatabaseStatusPill({
  runtime,
  latestDeploymentStatus,
}: {
  runtime: DbResource["runtime"] | undefined;
  latestDeploymentStatus?: DbResource["latestDeploymentStatus"];
}) {
  // A staged create has no container, so the draft the graph panel builds
  // from the manifest carries no `runtime`. Reading the deploy-in-flight
  // flag before this guard is what took the whole graph route down to the
  // error boundary once; it stays the first branch.
  if (!runtime) return <PanelStatusPill tone="pending" label="pending" />;
  const deploying =
    runtime.status !== "running" &&
    runtime.status !== "starting" &&
    (latestDeploymentStatus === "building" ||
      latestDeploymentStatus === "pending" ||
      latestDeploymentStatus === "starting");
  if (deploying) return <PanelStatusPill tone="building" label="deploying" />;
  switch (runtime.status) {
    case "running":
      return runtime.health === "unhealthy" ? (
        <PanelStatusPill tone="error" label="unhealthy" />
      ) : (
        <PanelStatusPill tone="running" label="running" />
      );
    case "starting":
      return <PanelStatusPill tone="building" label="starting" />;
    case "stopped":
      return <PanelStatusPill tone="paused" label="stopped" />;
    default:
      return <PanelStatusPill tone="error" label={runtime.status} />;
  }
}

/** Each engine gets its native browser; unsupported engines say so plainly
 *  rather than falling back to the SQL console. */
export function DatabaseDataTab({ resource }: { resource: DbResource }) {
  if (resource.engine === "postgres") return <DataTabBody resource={resource} />;
  if (resource.engine === "redis") return <RedisDataTabBody resource={resource} />;
  if (resource.engine === "mariadb") return <MariadbDataTabBody resource={resource} />;
  if (resource.engine === "mongodb") return <MongoDataTabBody resource={resource} />;
  return <UnsupportedDataViewer engine={resource.engine} />;
}
