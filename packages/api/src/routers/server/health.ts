/**
 * Per-server health read — latest server_health_sample rows for the org
 * (written by the local 60s sampler + remote health agents; see
 * docs/designs/server-health-agent.md). Payloads are re-validated against the
 * current HostHealth contract shape here: a sample written by a skewed agent
 * version degrades to `health: null` for that row instead of failing the
 * whole list.
 */
import type { ServerId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { serverHealthSample } from "@otterdeploy/db/schema/server";
import { eq } from "drizzle-orm";
import type * as z from "zod";

import { HEALTH_SAMPLE_INTERVAL_MS } from "../../system-health/agent-ingest";
import { hostHealthSchema } from "../system/contract";

const STALE_AFTER_MS = HEALTH_SAMPLE_INTERVAL_MS * 3;

export interface ServerHealthEntry {
  serverId: ServerId;
  hostname: string | null;
  health: z.infer<typeof hostHealthSchema> | null;
  sampledAt: string;
  receivedAt: string;
  stale: boolean;
}

export async function getServerHealth(input: {
  organizationId: string;
}): Promise<ServerHealthEntry[]> {
  const rows = await db
    .select()
    .from(serverHealthSample)
    .where(eq(serverHealthSample.organizationId, input.organizationId));

  const now = Date.now();
  return rows.map((row) => {
    const parsed = hostHealthSchema.safeParse(row.payload);
    return {
      serverId: row.serverId,
      hostname: row.hostname,
      health: parsed.success ? parsed.data : null,
      sampledAt: row.sampledAt.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
      stale: now - row.receivedAt.getTime() > STALE_AFTER_MS,
    };
  });
}
