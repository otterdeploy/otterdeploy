/**
 * Presentational pieces for {@link RealResourcePanel} — pulled into a sibling
 * module so the panel component stays small. The header (back / restart /
 * close), the status row, the runtime badge, and the engine-specific data
 * browser switch all live here.
 */

import { ArrowLeft01Icon, Cancel01Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { ResourceEngine } from "@/features/projects/components/graph/resource-node";

import { PanelIcon } from "@/features/resources/components/_shared/atoms";
import { UnsupportedDataViewer } from "@/features/resources/components/_shared/data/unsupported-data-viewer";
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
  onClose,
  onRestart,
  restarting,
}: {
  resource: DbResource;
  pending: boolean;
  onClose: () => void;
  onRestart: () => void;
  restarting: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pt-6">
      <div className="flex items-start gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Back to graph"
          onClick={onClose}
          className="mt-1"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />
        </Button>
        <PanelIcon
          node={{
            kind: "database",
            name: resource.name,
            description: "",
            engine: resource.engine as ResourceEngine,
          }}
        />
        <div className="flex flex-col gap-0.5">
          <span className="text-xl leading-none font-bold tracking-tight">{resource.name}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {resource.engine}
            {!pending && (
              <>
                {" "}
                <span className="text-muted-foreground/50">·</span> {resource.databaseName}
              </>
            )}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {/* Restart needs a running container — omit it while the database is
            still a staged create (Deploy from the pending bar). */}
        {!pending && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRestart}
            disabled={restarting}
          >
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
            {restarting ? "Restarting…" : "Restart"}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close panel"
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function DatabaseStatusBar({
  pending,
  runtime,
}: {
  pending: boolean;
  runtime: DbResource["runtime"];
}) {
  return (
    <div className="mt-5 flex items-center gap-3 border-t border-border/40 px-6 py-3">
      {pending ? (
        <>
          <span className="rounded-md bg-info/12 px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em] text-info">
            PENDING
          </span>
          <span className="text-[13px] text-muted-foreground">
            Staged — Deploy the pending changes to create it
          </span>
        </>
      ) : (
        <>
          <RuntimeStatusBadge status={runtime.status} />
          <span className="text-[13px] text-muted-foreground">
            {runtime.health ?? "Provisioned"}
          </span>
        </>
      )}
    </div>
  );
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

function RuntimeStatusBadge({ status }: { status: string }) {
  const tone =
    status === "running"
      ? "bg-success/12 text-success"
      : status === "starting"
        ? "bg-warning/12 text-warning"
        : status === "error"
          ? "bg-destructive/12 text-destructive"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={`rounded-md px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em] ${tone}`}
    >
      {status.toUpperCase()}
    </span>
  );
}
