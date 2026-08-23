/**
 * Startup + shutdown for the control plane (split from index.ts under the file
 * cap). Order matters: migrations gate everything, then swarm → server IP →
 * Caddy reconcile → BullMQ workers → interval background services. The stop
 * handles captured here are drained by the SIGTERM/SIGINT hooks so in-flight
 * jobs finish before the process exits.
 */
import { reconcile } from "@otterdeploy/api/caddy";
import {
  startEdgeLogPersistence,
  startEdgeLogSink,
  maybeBackfillAnalytics,
  startEdgeAnalytics,
  startThreatRollup,
  stopThreatRollup,
} from "@otterdeploy/api/edge-logs";
import { edgeLogPersistEnabled } from "@otterdeploy/api/lib/platform-runtime-settings";
import { ensureServerIp, ensureServerIpv6 } from "@otterdeploy/api/lib/server-ip";
import { runProvisionJob } from "@otterdeploy/api/routers/server/provision-runner";
import { finalizeUpdateRunOnBoot } from "@otterdeploy/api/routers/system/apply";
import { initializeSwarm } from "@otterdeploy/api/swarm";
import { reloadAuth } from "@otterdeploy/auth";
import { runMigrations } from "@otterdeploy/db/migrate";
import { env } from "@otterdeploy/env/server";
import { createWorkers, jobs as allJobs, ProvisionServerPayload } from "@otterdeploy/jobs";
import { Result } from "better-result";
import { log } from "evlog";

import { startBackgroundServices } from "./background-services";
import { BootstrapError } from "./lib/errors";
import { isTracingConfigured, shutdownTracing, startTracing } from "./lib/tracing";

let stopWorkers: (() => Promise<void>) | null = null;
let stopBackgroundServices: (() => void) | null = null;
let stopTracing: (() => Promise<void>) | null = null;

/**
 * Resolve the host's public addresses before the Caddy reconcile, so a fresh
 * install publishes a reachable hostname instead of loopback.
 *
 * v4 anchors the sslip.io fallback domains (`<ip>.sslip.io`); v6 is
 * informational (AAAA records, operator reference) and legitimately absent on
 * an IPv4-only host. Neither is fatal: both are logged and stepped over, since
 * a control plane that boots with a wrong address is still reachable and
 * correctable from the Instance page, whereas one that refuses to boot is not.
 */
async function resolvePublicAddresses(): Promise<void> {
  const resolvers = [
    {
      step: "server-ip",
      run: () =>
        ensureServerIp({
          override: env.SERVER_IP ?? null,
          allowDetect: env.NODE_ENV !== "development",
        }),
    },
    {
      step: "server-ipv6",
      run: () =>
        ensureServerIpv6({
          override: env.SERVER_IPV6 ?? null,
          allowDetect: env.NODE_ENV !== "development",
        }),
    },
  ];

  for (const { step, run } of resolvers) {
    const resolved = await Result.tryPromise({
      try: run,
      catch: (cause) => new BootstrapError({ step, cause }),
    });
    resolved.match({
      ok: (result) => log.info({ startup: { step, source: result.source, ip: result.ip } }),
      err: (err) => log.error({ startup: { step, status: "failed" }, error: err.message }),
    });
  }
}

async function bootstrap() {
  // Apply any pending DB migrations BEFORE anything reads the schema. Idempotent
  // (tracked in drizzle.__drizzle_migrations, so a no-op once up to date) and
  // fail-fast: the control plane must never serve against a missing/half-migrated
  // schema (every query 500s with `relation "…" does not exist`). On failure we
  // exit non-zero and let `restart: unless-stopped` crash-loop until Postgres is
  // reachable and migrated, rather than come up broken.
  const migrated = await Result.tryPromise({
    try: () => runMigrations(),
    catch: (cause) => new BootstrapError({ step: "migrate", cause }),
  });
  migrated.match({
    ok: () => log.info({ startup: { step: "migrate", status: "ready" } }),
    err: (err) => {
      log.error({ startup: { step: "migrate", status: "failed" }, error: err.message });
      process.exit(1);
    },
  });

  // Settle a handed-off self-update: the OLD server dies at cutover, so only
  // this (new) process can record the terminal outcome. Compares the booted
  // version against the persisted target and finalizes update-status.json.
  // Without this the snapshot stays "running" forever. Best-effort.
  await finalizeUpdateRunOnBoot().catch((cause) =>
    log.warn({
      startup: { step: "update-finalize", status: "failed" },
      error: cause instanceof Error ? cause.message : String(cause),
    }),
  );

  // OpenTelemetry: opt-in, started first so auto-instrumentation patches as
  // much as possible. Dormant unless an OTLP collector is configured (else the
  // exporters would spam connection-refused against a default localhost:4318).
  if (isTracingConfigured()) {
    startTracing();
    stopTracing = shutdownTracing;
    log.info({ startup: { step: "otel-tracing", status: "ready" } });
  }

  // Rebuild the auth instance against the DB-resolved social sign-in providers.
  // Module evaluation could only use the env-seeded set (it's synchronous, and
  // Postgres wasn't necessarily reachable), so until this runs a provider the
  // operator configured in the UI isn't registered. Runs after migrations for
  // that reason. Never throws: a failure keeps the env-configured instance.
  const socialProviders = (await reloadAuth()).providers;
  log.info({ startup: { step: "auth-providers", status: "ready" }, socialProviders });

  // Edge-log sink: bind the TCP listener Caddy streams logs to. Both per-site
  // access logs and the global default logger's operational events (Phase 3).
  // Only when EDGE_LOG_SINK is configured (otherwise the Caddyfile carries
  // no `output net`, so nothing would connect anyway).
  if (env.EDGE_LOG_SINK) {
    // Persistence is a settings-backed toggle (env seeds it) and is read here,
    // at start, because it decides whether the writer loop exists at all,
    // which is exactly why its card says a change needs a restart.
    const persist = await edgeLogPersistEnabled();
    Result.try({
      try: () => {
        startEdgeLogSink(env.EDGE_LOG_PORT);
        // Persist behind the live ring unless explicitly disabled, so the
        // 24h/7d ranges and percentiles work and survive restarts.
        if (persist) startEdgeLogPersistence();
        // Scanner-probe counters, always on: they're cheap (one upsert per
        // probing IP per flush) and they're the ONLY record that outlives the
        // raw log's retention sweep. The Firewall panel's all-time view reads
        // them.
        startThreatRollup();
        // Analytics rollups, always on for the same reason: the Analytics
        // surface reads these, not the raw log. Async (seeds today's day rows
        // first) and self-guarding: a failed seed logs and refuses to enable
        // rather than risking a clobbering day flush. Once running, the
        // one-shot backfill replays surviving raw days so the Analytics tab
        // has history on the first deploy.
        void startEdgeAnalytics().then(() => maybeBackfillAnalytics());
      },
      catch: (cause) => new BootstrapError({ step: "edge-log-sink", cause }),
    }).match({
      ok: () =>
        log.info({
          startup: {
            step: "edge-log-sink",
            port: env.EDGE_LOG_PORT,
            persist,
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

  await resolvePublicAddresses();

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
    // queue from the git-webhook receiver. Only the consumer moves.
    try: () =>
      createWorkers({
        // deploy.triggered runs in apps/builder (needs the railpack/docker
        // toolchain). server.provision's real handler lives in @otterdeploy/api
        // (SSH + manager socket) and can't live in packages/jobs, so we swap it
        // in here: same override mechanism the builder uses for deploys.
        jobs: allJobs
          .filter((j) => j.name !== "deploy.triggered")
          .map((j) =>
            j.name === "server.provision"
              ? {
                  ...j,
                  handler: (payload: unknown) =>
                    runProvisionJob(ProvisionServerPayload.parse(payload)),
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
  // roles, blocklists, data-folder GC, audit anomalies): see
  // background-services.ts; each logs its own readiness line.
  stopBackgroundServices = startBackgroundServices();
}

/** Kick off startup and arm the SIGTERM/SIGINT drain. Fire-and-forget from
 *  index.ts: the HTTP server serves immediately; readiness is per-step. */
export function runBootstrap(): void {
  void bootstrap();

  // Drain workers on SIGTERM / SIGINT so in-flight jobs finish before exit.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, async () => {
      log.info({ shutdown: { signal, step: "draining-workers" } });
      if (stopBackgroundServices) stopBackgroundServices();
      // Flush the last few seconds of probe counters before exit: they're
      // all-time totals, so a dropped buffer is history lost for good.
      await stopThreatRollup().catch(() => undefined);
      if (stopTracing) await stopTracing().catch(() => undefined);
      if (stopWorkers) await stopWorkers().catch(() => undefined);
      process.exit(0);
    });
  }
}
