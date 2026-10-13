/**
 * Boundaries the control plane owns, written into the correction ledger with
 * the control plane as their source: a check's deletion (a tombstone that
 * ends the reporting interval of every series of that check) and the start or
 * end of a maintenance window (an overlay a report may exclude). Nodes cannot
 * name a check revision, and maintenance is control-plane configuration, so
 * neither arrives in node telemetry.
 *
 * Each call is idempotent: the marker's sequence and batch id derive from
 * what it records, so a retried call is a no-op. The check registry calls
 * this when it lands; nothing calls it yet.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import type { IngestMarker, MarkerTarget } from "./ingest-model";

import { Ingestor } from "./ingest";
import { KIND, nowMs } from "./model";

/**
 * The control plane as a ledger source. `#` is outside the node id alphabet,
 * so no node can ever report as it.
 */
const CONTROL_PLANE = { sourceNodeId: "#control-plane", nodeEpoch: 0, bootId: "#control-plane" };

export type ControlPlaneMarker =
  | {
      kind: "check-deleted";
      organizationId: OrganizationId;
      checkId: string;
      /** null: every revision of the check. */
      checkRevision: number | null;
      at: number;
    }
  | {
      kind: "maintenance-start" | "maintenance-end";
      organizationId: OrganizationId;
      /** A check (optionally one revision), or every series of a subject. */
      scope: { checkId: string; checkRevision: number | null } | { subjectId: string };
      at: number;
    };

const MARKER_KIND = {
  "check-deleted": KIND.tombstone,
  "maintenance-start": KIND.maintenanceStart,
  "maintenance-end": KIND.maintenanceEnd,
} as const;

function targetOf(m: ControlPlaneMarker): MarkerTarget {
  if (m.kind === "check-deleted") {
    return {
      kind: "check",
      organizationId: m.organizationId,
      checkId: m.checkId,
      checkRevision: m.checkRevision,
    };
  }
  return "subjectId" in m.scope
    ? { kind: "org-subject", organizationId: m.organizationId, subjectId: m.scope.subjectId }
    : { kind: "check", organizationId: m.organizationId, ...m.scope };
}

/** Record one control-plane boundary on every series it covers. */
export function recordControlPlaneMarker(
  marker: ControlPlaneMarker,
  options: { ingestor?: Ingestor; receivedAt?: number } = {},
) {
  const kind = MARKER_KIND[marker.kind];
  const target = targetOf(marker);
  const ingestMarker: IngestMarker = {
    kind,
    t: marker.at,
    // One marker of a kind per instant: the sequence is derived, so a retry dedupes.
    seq: marker.at * 8 + kind,
    target,
  };
  const ingestor = options.ingestor ?? new Ingestor();
  return ingestor.ingest(
    {
      source: CONTROL_PLANE,
      batchId: `${marker.kind}:${JSON.stringify(target)}:${marker.at}`,
      live: true,
      records: [],
      markers: [ingestMarker],
    },
    options.receivedAt ?? nowMs(),
  );
}
