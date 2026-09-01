/**
 * Everything the workbench can be pointed at, as one list.
 *
 * Two sources, one shape. A managed database comes from the org catalog and a
 * saved connection from its collection, and the switcher does not care which is
 * which beyond a label — the whole point of the `WorkbenchTarget` union is that
 * nothing downstream branches on it.
 *
 * Engines without a wire driver are filtered out here rather than shown and
 * then failing on open. A Redis resource is a real database with a real viewer;
 * it is simply not something this surface can serve.
 */
import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";

import { hasWireDriver } from "@otterdeploy/data-engine";
import { isDatabaseEngine } from "@otterdeploy/shared/database-engines";

import { useDatabaseCatalog } from "@/features/databases/data";

import type { DataConnection } from "./connections";
import type { WorkbenchTarget } from "./target";

import { useDataConnections } from "./connections";
import { connectionTarget, resourceTarget, targetKey } from "./target";

export interface WorkbenchTargetOption {
  /** Stable key: also what the URL carries. */
  key: string;
  target: WorkbenchTarget;
  name: string;
  engine: DatabaseEngine;
  /** Where it lives: `project/name` for managed, host for external. */
  subtitle: string;
  kind: "managed" | "external";
  /** False when the database is known to be down or the credential is stale. */
  healthy: boolean;
  /** Production external connections are pinned read-only; say so up front. */
  readOnly: boolean;
  /** Canonical tags; empty for managed databases, which are found by project. */
  tags: readonly string[];
  /**
   * The saved row behind an external option, so the switcher can offer to
   * edit it. Absent for managed databases: their settings live on the
   * resource, not here.
   */
  connection?: DataConnection;
}

export function useWorkbenchTargets(organizationId: string) {
  const catalog = useDatabaseCatalog();
  const { connections, isLoading: connectionsLoading } = useDataConnections(organizationId);

  // The catalog's engine list is wider than `DatabaseEngine` — it also carries
  // the non-database services (minio, meilisearch, rabbitmq) the catalog page
  // shows. Narrow with the shared guard rather than assuming the overlap.
  const managed: WorkbenchTargetOption[] = (catalog.data?.databases ?? [])
    .flatMap((d) => (isDatabaseEngine(d.engine) ? [{ ...d, engine: d.engine }] : []))
    .filter((d) => hasWireDriver(d.engine))
    .map((d) => ({
      key: targetKey(resourceTarget(d.resourceId)),
      target: resourceTarget(d.resourceId),
      name: d.name,
      engine: d.engine,
      subtitle: `${d.projectSlug} · ${d.engineLabel}`,
      kind: "managed",
      // The catalog already probes reachability; a database we cannot reach is
      // still worth listing, greyed, rather than silently absent.
      healthy: d.runtimeStatus === "running",
      readOnly: false,
      tags: [],
    }));

  const external: WorkbenchTargetOption[] = connections.map((c) => ({
    key: targetKey(connectionTarget(c.id)),
    target: connectionTarget(c.id),
    name: c.name,
    engine: c.engine,
    subtitle: `${c.displayHost} · ${c.displayDatabase}`,
    kind: "external",
    // A connection that has never opened is not unhealthy, just unproven.
    healthy: true,
    readOnly: c.environment === "production" || c.defaultAccess === "read-only",
    tags: c.tags,
    connection: c,
  }));

  return {
    managed,
    external,
    all: [...managed, ...external],
    isLoading: catalog.isLoading || connectionsLoading,
  };
}

/**
 * Resolve the `?target=` search param back to an option.
 *
 * No fallback. An absent or unknown target means "nothing is open", and the
 * page shows the picker; it does not open the first database on someone's
 * behalf, because opening one starts a session.
 */
export function findTarget(
  options: readonly WorkbenchTargetOption[],
  key: string | undefined,
): WorkbenchTargetOption | undefined {
  if (key === undefined) return undefined;
  return options.find((option) => option.key === key);
}
