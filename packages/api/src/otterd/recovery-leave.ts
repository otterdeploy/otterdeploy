/**
 * Leaving recovery mode after a platform update.
 *
 * The node starts the control plane of a freshly updated platform in
 * recovery mode (`OTTERDEPLOY_RECOVERY=1` from the manifest's recovery
 * environment). Once this control plane is healthy and its schema is
 * current, it tells its own node `platform.recovered {manifestDigest}`; the
 * node records that once per manifest and recreates the control plane in
 * normal mode. Until every condition holds nothing is sent, and a refusal
 * (another manifest is active, an update is still running) is retried.
 */
import { db } from "@otterdeploy/db";
import { Result } from "better-result";
import { sql } from "drizzle-orm";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Hub } from "./hub/hub";

import { journal } from "./store/journal";
import { buildHostNode } from "./store/status";

/** Phases after which no platform update is in progress. */
const SETTLED = new Set(["committed", "rolled-back"]);
const RETRY_MS = 30_000;

export interface RecoveryLeaveConfig {
  hub: Pick<Hub, "platformOf" | "request">;
  now: () => number;
  /** Where the schema migrations ship (DB_MIGRATIONS_DIR in the image). */
  migrationsDir?: string;
}

/** Every migration this build ships has been applied. */
async function schemaCurrent(dir: string | undefined): Promise<boolean> {
  const folder = dir ?? fileURLToPath(new URL("../../../db/src/migrations", import.meta.url));
  const shipped = (await readdir(folder, { withFileTypes: true })).filter((e) => e.isDirectory());
  const rows = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
  );
  const applied = Number(rows[0]?.n ?? 0);
  return applied >= shipped.length;
}

/** The node and manifest to report, once every condition holds; null until then. */
async function readyToLeave(cfg: RecoveryLeaveConfig) {
  const host = await buildHostNode();
  const nodeId = host.isOk() ? host.value : null;
  const report = nodeId ? cfg.hub.platformOf(nodeId) : null;
  const updating = report?.update !== undefined && !SETTLED.has(report.update.phase);
  if (!nodeId || !report?.manifestDigest || updating) return null;
  const current = await Result.tryPromise({
    try: () => schemaCurrent(cfg.migrationsDir),
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  });
  return current.isOk() && current.value ? { nodeId, digest: report.manifestDigest } : null;
}

/** A closure the scheduler loop calls on each pass; true once the node has the record. */
export function recoveryLeave(cfg: RecoveryLeaveConfig): () => Promise<boolean> {
  let done = false;
  let lastTry = 0;
  return async () => {
    if (done || cfg.now() - lastTry < RETRY_MS) return done;
    const ready = await readyToLeave(cfg);
    if (!ready) return false;
    lastTry = cfg.now();
    const { nodeId, digest } = ready;
    const answer = await cfg.hub.request(
      nodeId,
      { verb: "platform.recovered", manifestDigest: digest },
      { opId: `recovered-${digest.slice(0, 32)}`, operationEpoch: 0 },
    );
    done =
      answer.isOk() &&
      answer.value.kind === "outcome" &&
      answer.value.outcome.status === "completed";
    await journal(db, {
      at: cfg.now(),
      kind: done ? "platform-recovered" : "platform-recovered-refused",
      nodeId,
      detail: {
        manifestDigest: digest,
        answer: answer.isOk() ? answer.value : answer.error.message,
      },
    });
    return done;
  };
}
