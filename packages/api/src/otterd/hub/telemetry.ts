/**
 * Node telemetry into the health ingest: decode the frame against the
 * reporting node's identity, ingest it (a resent batch id is a no-op), and
 * acknowledge with the credit the batch consumed so the node may send more.
 */
import type { SampleBatch } from "@otterdeploy/otterd-proto";
import type { OrganizationId } from "@otterdeploy/shared/id";

import { decodeSampleBatch } from "../../health-data/frames";
import { Ingestor } from "../../health-data/ingest";

interface TelemetryAck {
  disposition: "accepted" | "deferred" | "refused";
  /** Credit returned: one per probe result, metric sample, marker and signal. */
  credit: number;
}

const batchItems = (b: SampleBatch): number =>
  (b.probes?.length ?? 0) +
  (b.metrics?.length ?? 0) +
  (b.markers?.length ?? 0) +
  (b.signals?.length ?? 0);

export function telemetrySink(installId: string, organizationId: OrganizationId | null) {
  const ingestor = new Ingestor();
  return async (batch: SampleBatch): Promise<TelemetryAck> => {
    const credit = batchItems(batch);
    if (organizationId === null) return { disposition: "refused", credit };
    const decoded = decodeSampleBatch(batch, { installId, nodeOrganizationId: organizationId });
    if (decoded.isErr()) return { disposition: "refused", credit };
    const ingested = await ingestor.ingest(decoded.value.batch);
    // A database failure is transient: the node keeps the batch and resends it.
    return {
      disposition: ingested.isOk() ? "accepted" : "deferred",
      credit: ingested.isOk() ? credit : 0,
    };
  };
}
