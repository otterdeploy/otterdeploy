import type { OrganizationId } from "@otterdeploy/shared/id";
/**
 * The ingest's normalized input: what any wire format decodes to. A record is
 * one probe round's final result or one metric sample; a marker is a
 * stateless boundary (tombstone, boot, gap, maintenance) that cuts its
 * predecessor so nothing interpolates through it.
 */
import type { JsonObject } from "@otterdeploy/shared/json";

import { createHash } from "node:crypto";

import { type ProbeState, SERIES_KIND, type SeriesKind } from "./model";

/**
 * Full series identity. Boot and sequence identify records, not series. Optional contract fields (generation, attempt) are null when the
 * node did not send them; they are still part of the identity.
 */
export type SeriesIdentity =
  | {
      kind: "probe";
      organizationId: OrganizationId;
      /** The observer node that ran the probe. */
      sourceNodeId: string;
      checkId: string;
      checkRevision: number;
      subjectId: string;
      generation: number | null;
      attemptId: string | null;
      /** Vantage kind (local-netns, serving-path, fleet, hairpin, outside). */
      vantage: string;
    }
  | {
      kind: "metric";
      organizationId: OrganizationId;
      /** The node the subject runs on. */
      sourceNodeId: string;
      subjectId: string;
      generation: number | null;
      attemptId: string | null;
      dimensionSet: string;
      schemaVersion: number;
    };

/** The dimension set of per-container series: not counted by the node dimension quota. */
export const CONTAINER_DIMENSION_SET = "container";

export interface IngestRecord {
  series: SeriesIdentity;
  /** Event time, epoch ms. */
  t: number;
  /** Per-boot sample sequence. */
  seq: number;
  state: ProbeState;
  uncMs: number;
  ttlMs: number;
  latUs: number | null;
  attUs: readonly number[] | null;
  vals: readonly (number | null)[] | null;
  /** Probe-only raw payload; null for metrics. */
  probe: { round: number; outcome: number; cause: number; detail: JsonObject } | null;
}

/** Which series of the reporting node a marker cuts. */
export type MarkerTarget =
  /** Every series the node reports (a boot). */
  | { kind: "node" }
  /** Every series of one subject on the node, optionally one dimension set. */
  | { kind: "subject"; subjectId: string; dimensionSet: string | null }
  /** Every series of a check, on every node and vantage (control plane only). */
  | { kind: "check"; organizationId: OrganizationId; checkId: string; checkRevision: number | null }
  /** Every series of a subject in an organization, on every node (control plane only). */
  | { kind: "org-subject"; organizationId: OrganizationId; subjectId: string }
  /** One exact series (control-plane-written boundaries: check tombstones, maintenance). */
  | { kind: "series"; identity: SeriesIdentity };

export interface IngestMarker {
  kind: 1 | 2 | 3 | 4 | 5 | 6;
  t: number;
  /** Drawn from the same per-boot sequence as samples. */
  seq: number;
  target: MarkerTarget;
}

export interface IngestBatch {
  source: { sourceNodeId: string; nodeEpoch: number; bootId: string };
  /** The sender's id for this batch: a resent batch with the same id is a no-op. */
  batchId: string | null;
  /** Live rounds are current; replay is history only and has its own lane. */
  live: boolean;
  records: readonly IngestRecord[];
  markers: readonly IngestMarker[];
}

export function seriesKindOf(identity: SeriesIdentity): SeriesKind {
  return identity.kind === "probe" ? SERIES_KIND.probe : SERIES_KIND.metric;
}

/** Counts against the node dimension quota: host and bounded per-node dimensions. */
export function isNodeDimension(identity: SeriesIdentity): boolean {
  return identity.kind === "metric" && identity.dimensionSet !== CONTAINER_DIMENSION_SET;
}

/** Canonical, order-stable key of a series identity. */
export function identityKey(identity: SeriesIdentity): string {
  return identity.kind === "probe"
    ? JSON.stringify([
        "p",
        identity.organizationId,
        identity.sourceNodeId,
        identity.checkId,
        identity.checkRevision,
        identity.subjectId,
        identity.generation,
        identity.attemptId,
        identity.vantage,
      ])
    : JSON.stringify([
        "m",
        identity.organizationId,
        identity.sourceNodeId,
        identity.subjectId,
        identity.generation,
        identity.attemptId,
        identity.dimensionSet,
        identity.schemaVersion,
      ]);
}

/** Payload digest: same identity with another digest is a contradiction. */
export function digestOf(value: unknown): Buffer {
  return createHash("sha256").update(JSON.stringify(value)).digest().subarray(0, 8);
}
