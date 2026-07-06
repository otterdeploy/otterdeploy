/**
 * Health agent — the per-node reporter role of the unified server image
 * (docs/designs/server-health-agent.md). Deployed by the control plane as a
 * swarm GLOBAL service (one task per node); samples the node it runs on with
 * the same getHostHealth() the local path uses and POSTs the snapshot to the
 * control-plane ingest route.
 *
 * Deliberately imports ONLY system-health/host-health (DB-free; raw
 * process.env) — this process must boot with no DATABASE_URL, no validated
 * env, nothing but a docker socket and three env vars:
 *   HEALTH_AGENT_INGEST_URL  where to POST (e.g. http://<ip>:3000/api/agent/health)
 *   HEALTH_AGENT_TOKEN       HMAC token minted by the reconciler
 *   OTTERDEPLOY_NODE_HOSTNAME  swarm-templated {{.Node.Hostname}} — the
 *     attribution key; falls back to os.hostname() (the container id in a
 *     container, so the template matters in swarm).
 */
import { getHostHealth } from "@otterdeploy/api/system-health/host-health";
import { log } from "evlog";
import { hostname as osHostname, cpus, totalmem } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

/* oxlint-disable no-process-env -- the whole point of this entrypoint is
 * booting from raw env with NO validated schema (see module note) */
const INGEST_URL = process.env.HEALTH_AGENT_INGEST_URL;
const TOKEN = process.env.HEALTH_AGENT_TOKEN;
const NODE_HOSTNAME = process.env.OTTERDEPLOY_NODE_HOSTNAME || osHostname();
const INTERVAL_MS = Number(process.env.HEALTH_AGENT_INTERVAL_MS) || 60_000;
/* oxlint-enable no-process-env */

if (!INGEST_URL || !TOKEN) {
  log.error({ healthAgent: { fatal: "HEALTH_AGENT_INGEST_URL and HEALTH_AGENT_TOKEN are required" } });
  process.exit(1);
}

log.info({
  healthAgent: { event: "start", hostname: NODE_HOSTNAME, ingest: INGEST_URL, intervalMs: INTERVAL_MS },
});

let failures = 0;

async function reportOnce(): Promise<void> {
  const health = await getHostHealth();
  const res = await fetch(INGEST_URL as string, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      hostname: NODE_HOSTNAME,
      health,
      capacity: { cpuTotal: cpus().length, memTotalGb: totalmem() / 1024 ** 3 },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok && res.status !== 202) throw new Error(`ingest responded ${res.status}`);
  failures = 0;
}

for (;;) {
  try {
    await reportOnce();
  } catch (cause) {
    failures += 1;
    log.warn({
      healthAgent: {
        event: "report-failed",
        failures,
        error: cause instanceof Error ? cause.message : String(cause),
      },
    });
  }
  // Linear backoff on repeated failures (control plane restarting/updating),
  // capped at 5× the interval so recovery is never more than a few min out.
  await sleep(INTERVAL_MS * Math.min(1 + failures, 5));
}
