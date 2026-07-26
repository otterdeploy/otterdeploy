/**
 * Health agent — the per-node reporter role of the unified server image
 * (docs/designs/server-health-agent.md, od-5j8.20). Deployed by the control
 * plane as a swarm GLOBAL service (one task per node); samples the node it
 * runs on with the same getHostHealth() the local path uses and POSTs the
 * snapshot to the control-plane ingest route.
 *
 * Deliberately imports ONLY system-health/host-health (DB-free; raw
 * process.env) — this process must boot with no DATABASE_URL, no validated
 * env, nothing but a docker socket and a handful of env vars:
 *   HEALTH_AGENT_INGEST_URL     where to POST health reports
 *   HEALTH_AGENT_REGISTER_URL   where to trade the bootstrap token for a
 *                                session credential
 *   HEALTH_AGENT_BOOTSTRAP_TOKEN  short-lived, service-wide — good for
 *                                 nothing except calling /register
 *   OTTERDEPLOY_NODE_HOSTNAME   swarm-templated {{.Node.Hostname}} — the
 *     attribution key; falls back to os.hostname() (the container id in a
 *     container, so the template matters in swarm).
 *
 * od-5j8.20 trust model: the bootstrap token above is NEVER sent as the
 * report bearer. On startup (and again on a rolling refresh, well before
 * expiry) this process calls POST {REGISTER_URL} with the bootstrap token to
 * obtain a session credential bound to (this server row, this hostname) —
 * see agent-credential.ts. Every `/health` POST after that carries the
 * session credential, not the bootstrap token. A captured session credential
 * is short-lived, cannot be replayed against a different node's hostname
 * claim, and is revoked immediately if the control plane removes this node.
 */
import { getHostHealth } from "@otterdeploy/api/system-health/host-health";
import { log } from "evlog";
import { hostname as osHostname, cpus, totalmem } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

/* oxlint-disable no-process-env -- the whole point of this entrypoint is
 * booting from raw env with NO validated schema (see module note) */
const INGEST_URL = process.env.HEALTH_AGENT_INGEST_URL;
const REGISTER_URL = process.env.HEALTH_AGENT_REGISTER_URL;
const BOOTSTRAP_TOKEN = process.env.HEALTH_AGENT_BOOTSTRAP_TOKEN;
const NODE_HOSTNAME = process.env.OTTERDEPLOY_NODE_HOSTNAME || osHostname();
const INTERVAL_MS = Number(process.env.HEALTH_AGENT_INTERVAL_MS) || 60_000;
/* oxlint-enable no-process-env */

if (!INGEST_URL || !REGISTER_URL || !BOOTSTRAP_TOKEN) {
  log.error({
    healthAgent: {
      fatal:
        "HEALTH_AGENT_INGEST_URL, HEALTH_AGENT_REGISTER_URL and HEALTH_AGENT_BOOTSTRAP_TOKEN are required",
    },
  });
  process.exit(1);
}

log.info({
  healthAgent: {
    event: "start",
    hostname: NODE_HOSTNAME,
    ingest: INGEST_URL,
    intervalMs: INTERVAL_MS,
  },
});

let failures = 0;

interface Session {
  credential: string;
  /** Epoch ms. */
  expiresAt: number;
}
let session: Session | null = null;

/** Refresh once remaining lifetime drops under this many ms — keeps a report
 *  cycle from ever racing an about-to-expire credential. This process is
 *  deliberately DB/import-free (see module note), so it can't import
 *  agent-credential.ts's SESSION_TTL_SECONDS directly; 12 minutes is 20% of
 *  that module's 1-hour TTL — update both together if either changes. */
const REFRESH_MARGIN_MS = 12 * 60 * 1000;

async function register(): Promise<Session> {
  const res = await fetch(REGISTER_URL as string, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${BOOTSTRAP_TOKEN}` },
    body: JSON.stringify({ hostname: NODE_HOSTNAME }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`register responded ${res.status}`);
  }
  const body = (await res.json()) as { credential: string; expiresAt: string };
  const expiresAt = Date.parse(body.expiresAt);
  if (!body.credential || Number.isNaN(expiresAt)) {
    throw new Error("register returned a malformed session credential");
  }
  return { credential: body.credential, expiresAt };
}

async function ensureSession(): Promise<Session> {
  if (session && session.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return session;
  }
  const fresh = await register();
  session = fresh;
  log.info({
    healthAgent: { event: "session-registered", expiresAt: new Date(fresh.expiresAt).toISOString() },
  });
  return fresh;
}

async function reportOnce(): Promise<void> {
  const current = await ensureSession();
  const health = await getHostHealth();
  const doReport = (credential: string) =>
    fetch(INGEST_URL as string, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${credential}` },
      body: JSON.stringify({
        hostname: NODE_HOSTNAME,
        health,
        capacity: { cpuTotal: cpus().length, memTotalGb: totalmem() / 1024 ** 3 },
      }),
      signal: AbortSignal.timeout(15_000),
    });

  let res = await doReport(current.credential);
  if (res.status === 401) {
    // The control plane rejected the session credential outright (e.g. it
    // was revoked out from under us — a race with node removal, or the
    // control plane restarted with a fresh signing key). One immediate
    // re-register-and-retry before falling through to the normal backoff.
    session = null;
    const refreshed = await ensureSession();
    res = await doReport(refreshed.credential);
  }
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
