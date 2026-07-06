/**
 * Health-agent lifecycle (docs/designs/server-health-agent.md):
 *
 *  - startLocalHealthSampler — every 60s, sample THIS machine with
 *    getHostHealth() and upsert into server_health_sample for the bootstrap
 *    localhost row(s). Runs under every runtime; on the single-host default
 *    this alone makes per-server health complete.
 *
 *  - startHealthAgentReconciler — swarm runtime only: ensure the
 *    `otterdeploy-health-agent` GLOBAL service exists (one task per node,
 *    including late joiners). The spec is hand-built, not routed through
 *    buildServiceSpec — the agent is platform infrastructure, not an app
 *    service, and it needs Mode.Global which the app builder doesn't emit.
 *    Drift (image or ingest URL changed, e.g. after a platform update)
 *    recreates the service, which also re-mints the token.
 *
 * The MANAGER node runs both the local sampler AND an agent task; both write
 * the same row via the same upsert, so the duplication is harmless (last
 * writer wins with identical data).
 */
import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { server } from "@otterdeploy/db/schema/server";
import { Docker } from "@otterdeploy/docker";
import { env } from "@otterdeploy/env/server";
import { eq } from "drizzle-orm";
import { log } from "evlog";
import { hostname as osHostname, cpus, totalmem } from "node:os";

import { isSwarmRuntime } from "../runtime";
import { HEALTH_SAMPLE_INTERVAL_MS, recordHealthSample } from "./agent-ingest";
import { mintAgentToken } from "./agent-token";
import { getHostHealth } from "./host-health";

const AGENT_SERVICE_NAME = "otterdeploy-health-agent";
const RECONCILE_INTERVAL_MS = 10 * 60 * 1000;

// ─── local sampler ──────────────────────────────────────────────────────────

async function sampleLocalHost(): Promise<void> {
  // The bootstrap convention: every org gets a `localhost` row for the
  // machine the control plane runs on. Match by host, not hostname — the
  // hostname column mirrors os.hostname() but `host` is the stable key.
  const rows = await db
    .select({
      id: server.id,
      organizationId: server.organizationId,
      cpuTotal: server.cpuTotal,
      memTotalGb: server.memTotalGb,
    })
    .from(server)
    .where(eq(server.host, "127.0.0.1"));
  if (rows.length === 0) return;

  const health = await getHostHealth();
  await recordHealthSample(rows, {
    hostname: osHostname(),
    health,
    capacity: { cpuTotal: cpus().length, memTotalGb: totalmem() / 1024 ** 3 },
  });
}

export function startLocalHealthSampler(): () => void {
  const run = () =>
    void sampleLocalHost().catch((cause) =>
      log.warn({
        healthSampler: { error: cause instanceof Error ? cause.message : String(cause) },
      }),
    );
  run();
  const timer = setInterval(run, HEALTH_SAMPLE_INTERVAL_MS);
  return () => clearInterval(timer);
}

// ─── swarm agent reconciler ─────────────────────────────────────────────────

function agentImage(): string {
  return `${env.OTTERDEPLOY_REGISTRY}/server:${env.OTTERDEPLOY_VERSION}`;
}

/** Where agents POST. Prefers the explicit override (odd topologies, private
 *  networks), else the platform serverIp — which multi-node installs need
 *  populated anyway for public URLs. */
async function resolveIngestUrl(): Promise<string | null> {
  // oxlint-disable-next-line node/no-process-env -- deploy-time escape hatch, not part of validated env
  const override = process.env.HEALTH_AGENT_INGEST_URL_OVERRIDE;
  if (override) return override;
  const [row] = await db
    .select({ serverIp: platformSettings.serverIp })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  const ip = env.SERVER_IP ?? row?.serverIp;
  if (!ip) return null;
  // oxlint-disable-next-line node/no-process-env -- compose-level var, deliberately outside validated env
  const port = process.env.CONTROL_PLANE_PORT ?? "3000";
  return `http://${ip}:${port}/api/agent/health`;
}

function buildAgentServiceSpec(image: string, ingestUrl: string, token: string) {
  return {
    Name: AGENT_SERVICE_NAME,
    Labels: {
      "otterdeploy.managed": "true",
      "otterdeploy.role": "health-agent",
      // Drift keys — reconcile compares these instead of diffing the spec.
      "otterdeploy.agent.image": image,
      "otterdeploy.agent.ingest": ingestUrl,
    },
    TaskTemplate: {
      ContainerSpec: {
        Image: image,
        // The unified image's run-from-source trick (builder does the same).
        Dir: "/app/apps/server",
        Command: ["bun", "run", "src/health-agent.ts"],
        Env: [
          `HEALTH_AGENT_INGEST_URL=${ingestUrl}`,
          `HEALTH_AGENT_TOKEN=${token}`,
          // Swarm env templating: each task learns which node it's on.
          "OTTERDEPLOY_NODE_HOSTNAME={{.Node.Hostname}}",
          `HEALTH_AGENT_INTERVAL_MS=${HEALTH_SAMPLE_INTERVAL_MS}`,
        ],
        Mounts: [
          { Type: "bind", Source: "/var/run/docker.sock", Target: "/var/run/docker.sock" },
        ],
        Labels: { "otterdeploy.managed": "true", "otterdeploy.role": "health-agent" },
      },
      RestartPolicy: { Condition: "any", Delay: 5_000_000_000 },
      Resources: { Limits: { MemoryBytes: 256 * 1024 * 1024 } },
    },
    Mode: { Global: {} },
  };
}

async function reconcileAgentService(): Promise<void> {
  const ingestUrl = await resolveIngestUrl();
  if (!ingestUrl) {
    log.warn({
      healthAgent: {
        event: "reconcile-skipped",
        reason: "no server IP on record — set it on the Instance page",
      },
    });
    return;
  }
  const image = agentImage();
  const docker = Docker.fromEnv();
  try {
    const listResult = await docker.services.list({ filters: { name: [AGENT_SERVICE_NAME] } });
    if (listResult.isErr()) throw listResult.error;
    const existing = listResult.value.find((s) => s.Spec?.Name === AGENT_SERVICE_NAME);

    if (existing) {
      const labels = (existing.Spec?.Labels ?? {}) as Record<string, string>;
      const drifted =
        labels["otterdeploy.agent.image"] !== image ||
        labels["otterdeploy.agent.ingest"] !== ingestUrl;
      if (!drifted) return;
      if (existing.ID) {
        const removed = await docker.services.getService(existing.ID).remove();
        if (removed.isErr()) throw removed.error;
      }
      log.info({ healthAgent: { event: "recreate", image, ingestUrl } });
    } else {
      log.info({ healthAgent: { event: "create", image, ingestUrl } });
    }

    const token = await mintAgentToken();
    const created = await docker.services.create(
      buildAgentServiceSpec(image, ingestUrl, token) as Parameters<
        typeof docker.services.create
      >[0],
    );
    if (created.isErr()) throw created.error;
  } finally {
    docker.destroy();
  }
}

export function startHealthAgentReconciler(): () => void {
  if (!isSwarmRuntime()) return () => {};
  const run = () =>
    void reconcileAgentService().catch((cause) =>
      log.warn({
        healthAgent: {
          event: "reconcile-failed",
          error: cause instanceof Error ? cause.message : String(cause),
        },
      }),
    );
  run();
  const timer = setInterval(run, RECONCILE_INTERVAL_MS);
  return () => clearInterval(timer);
}
