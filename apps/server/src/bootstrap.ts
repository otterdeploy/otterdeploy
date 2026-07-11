/**
 * Startup + shutdown for the control plane (split from index.ts under the file
 * cap). Order matters: migrations gate everything, then swarm → server IP →
 * Caddy reconcile → BullMQ workers → interval background services. The stop
 * handles captured here are drained by the SIGTERM/SIGINT hooks so in-flight
 * jobs finish before the process exits.
 */
import { reconcile } from "@otterdeploy/api/caddy";
import { startEdgeLogPersistence, startEdgeLogSink } from "@otterdeploy/api/edge-logs";
import { ensureServerIp } from "@otterdeploy/api/lib/server-ip";
import { runProvisionJob } from "@otterdeploy/api/routers/server/provision-runner";
import { finalizeUpdateRunOnBoot } from "@otterdeploy/api/routers/system/apply";
import { initializeSwarm } from "@otterdeploy/api/swarm";
import { runMigrations } from "@otterdeploy/db/migrate";
import { env } from "@otterdeploy/env/server";
import { createWorkers, jobs as allJobs, type ProvisionServerPayload } from "@otterdeploy/jobs";
import { Result } from "better-result";
import { log } from "evlog";

import { startBackgroundServices } from "./background-services";
import { BootstrapError } from "./lib/errors";
import { isTracingConfigured, shutdownTracing, startTracing } from "./lib/tracing";

let stopWorkers: (() => Promise<void>) | null = null;
let stopBackgroundServices: (() => void) | null = null;
let stopTracing: (() => Promise<void>) | null = null;

async function bootstrap() {
  // Apply any pending DB migrations BEFORE anything reads the schema. Idempotent
  // (tracked in drizzle.__drizzle_migrations, so a no-op once up to date) and
  // fail-fast: the control plane must never serve against a missing/half-migrated
  // schema (every query 500s with `relation "…" does not exist`). On failure we
  // exit non-zero and let `restart: unless-stopped` crash-loop until Postgres is
  // reachable and migrated, rather than come up broken.
  await (
    await Result.tryPromise({
      try: () => runMigrations(),
      catch: (cause) => new BootstrapError({ step: "migrate", cause }),
    })
  ).match({
    ok: () => log.info({ startup: { step: "migrate", status: "ready" } }),
    err: (err) => {
      log.error({ startup: { step: "migrate", status: "failed" }, error: err.message });
      process.exit(1);
    },
  });

  // Settle a handed-off self-update: the OLD server dies at cutover, so only
  // this (new) process can record the terminal outcome. Compares the booted
  // version against the persisted target and finalizes update-status.json —
  // without this the snapshot stays "running" forever. Best-effort.
  await finalizeUpdateRunOnBoot().catch((cause) =>
    log.warn({
      startup: { step: "update-finalize", status: "failed" },
      error: cause instanceof Error ? cause.message : String(cause),
    }),
  );

  // OpenTelemetry — opt-in, started first so auto-instrumentation patches as
  // much as possible. Dormant unless an OTLP collector is configured (else the
  // exporters would spam connection-refused against a default localhost:4318).
  if (isTracingConfigured()) {
    startTracing();
    stopTracing = shutdownTracing;
    log.info({ startup: { step: "otel-tracing", status: "ready" } });
  }

  // Edge-log sink: bind the TCP listener Caddy streams logs to — both per-site
  // access logs and the global default logger's operational events (Phase 3).
  // Only when EDGE_LOG_SINK is configured (otherwise the Caddyfile carries
  // no `output net`, so nothing would connect anyway).
  if (env.EDGE_LOG_SINK) {
    Result.try({
      try: () => {
        startEdgeLogSink(env.EDGE_LOG_PORT);
        // Persist behind the live ring unless explicitly disabled, so the
        // 24h/7d ranges and percentiles work and survive restarts.
        if (env.EDGE_LOG_PERSIST) startEdgeLogPersistence();
      },
      catch: (cause) => new BootstrapError({ step: "edge-log-sink", cause }),
    }).match({
      ok: () =>
        log.info({
          startup: {
            step: "edge-log-sink",
            port: env.EDGE_LOG_PORT,
            persist: env.EDGE_LOG_PERSIST,
          },
        }),
      err: (err) =>
        log.error({
          startup: { step: "edge-log-sink", status: "failed" },
          error: err.message,
        }),
    });
  }

  const swarm = await Result.tryPromise({
    try: () => initializeSwarm(),
    catch: (cause) => new BootstrapError({ step: "swarm", cause }),
  });
  swarm.match({
    ok: () => log.info({ startup: { step: "swarm", status: "ready" } }),
    err: (err) =>
      log.error({
        startup: { step: "swarm", status: "failed" },
        error: err.message,
      }),
  });

  // Resolve the public IP for sslip.io fallback domains before reconcile,
  // so a fresh install publishes a reachable hostname instead of loopback.
  // Override via SERVER_IP; auto-detected in production; skipped in dev.
  const serverIp = await Result.tryPromise({
    try: () =>
      ensureServerIp({
        override: env.SERVER_IP ?? null,
        allowDetect: env.NODE_ENV !== "development",
      }),
    catch: (cause) => new BootstrapError({ step: "server-ip", cause }),
  });
  serverIp.match({
    ok: (result) =>
      log.info({
        startup: { step: "server-ip", source: result.source, ip: result.ip },
      }),
    err: (err) =>
      log.error({
        startup: { step: "server-ip", status: "failed" },
        error: err.message,
      }),
  });

  const reconciled = await Result.tryPromise({
    try: () => reconcile(),
    catch: (cause) => new BootstrapError({ step: "caddy-reconcile", cause }),
  });
  reconciled.match({
    ok: (result) =>
      log.info({
        startup: {
          step: "caddy-reconcile",
          applied: result.applied.length,
          skipped: result.skipped.length,
          revision: result.revision,
        },
      }),
    err: (err) =>
      log.error({
        startup: { step: "caddy-reconcile", status: "failed" },
        error: err.message,
      }),
  });

  const workers = await Result.tryPromise({
    // The deploy.triggered worker runs in apps/builder (it needs the
    // railpack + docker binaries). The API still enqueues jobs onto that
    // queue from the git-webhook receiver — only the consumer moves.
    try: () =>
      createWorkers({
        // deploy.triggered runs in apps/builder (needs the railpack/docker
        // toolchain). server.provision's real handler lives in @otterdeploy/api
        // (SSH + manager socket) and can't live in packages/jobs, so we swap it
        // in here — same override mechanism the builder uses for deploys.
        jobs: allJobs
          .filter((j) => j.name !== "deploy.triggered")
          .map((j) =>
            j.name === "server.provision"
              ? {
                  ...j,
                  handler: (payload: unknown) => runProvisionJob(payload as ProvisionServerPayload),
                }
              : j,
          ),
      }),
    catch: (cause) => new BootstrapError({ step: "workers", cause }),
  });

  workers.match({
    ok: (handle) => {
      stopWorkers = handle.stop;
      log.info({ startup: { step: "workers", status: "ready" } });
    },
    err: (err) =>
      log.error({
        startup: { step: "workers", status: "failed" },
        error: err.message,
      }),
  });

  // Interval schedulers/sweepers (backups, metrics, host health, ephemeral DB
  // roles, blocklists, data-folder GC, audit anomalies) — see
  // background-services.ts; each logs its own readiness line.
  stopBackgroundServices = startBackgroundServices();
}

/** Kick off startup and arm the SIGTERM/SIGINT drain. Fire-and-forget from
 *  index.ts — the HTTP server serves immediately; readiness is per-step. */
export function runBootstrap(): void {
  void bootstrap();

  // Drain workers on SIGTERM / SIGINT so in-flight jobs finish before exit.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, async () => {
      log.info({ shutdown: { signal, step: "draining-workers" } });
      if (stopBackgroundServices) stopBackgroundServices();
      if (stopTracing) await stopTracing().catch(() => undefined);
      if (stopWorkers) await stopWorkers().catch(() => undefined);
      process.exit(0);
    });
  }
}
