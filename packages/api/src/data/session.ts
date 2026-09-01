/**
 * Workbench sessions: the thing a user opens and closes.
 *
 * Nothing about a database is reachable "by default". Picking a target in the
 * workbench opens a session; the session owns whatever it took to reach the
 * database — for a managed one, a tunnel into its container
 * (`./tunnel.ts`); for an external one, only the pooled connections — and
 * closing the session tears all of it down. Idle sessions are reaped, an
 * owner is capped at a handful, and everything lives in this process's
 * memory: a restart starts from none, with nothing left behind to sweep.
 *
 * Keyed by (owner, organization, target) rather than by a minted id, so
 * opening is idempotent — a second tab on the same database joins the
 * session instead of starting another tunnel — and so a caller cannot
 * present someone else's session: the key is derived from the caller.
 */
import type { DataConnectionId, OrganizationId, ResourceId, UserId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { databaseResource } from "@otterdeploy/db/schema";
import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import { findResourceContainerId } from "../backups/exec";
import { dataError, type DataError } from "./errors";
import { closePools } from "./pool";
import { openTunnel, type Tunnel } from "./tunnel";

export type SessionTarget =
  | { kind: "resource"; resourceId: ResourceId }
  | { kind: "connection"; connectionId: DataConnectionId };

export interface DataSession {
  key: string;
  owner: string;
  organizationId: OrganizationId;
  target: SessionTarget;
  /** Present for managed targets; external ones are reached directly. */
  tunnel: Tunnel | null;
  openedAt: number;
  lastUsedAt: number;
}

/** No RPC for this long and the session is closed on the owner's behalf. */
const SESSION_IDLE_MS = 10 * 60_000;
/** Live sessions per owner; the oldest idle one makes room for a new one. */
const MAX_SESSIONS_PER_OWNER = 5;
const REAP_EVERY_MS = 60_000;

const sessions = new Map<string, DataSession>();
let reaper: ReturnType<typeof setInterval> | null = null;

/** A machine credential has no user; its sessions are pooled under one owner. */
export function ownerOf(viewerId: UserId | null): string {
  return viewerId ?? "api-key";
}

function targetKeyOf(target: SessionTarget): string {
  return target.kind === "resource"
    ? `resource:${target.resourceId}`
    : `connection:${target.connectionId}`;
}

export function sessionKey(input: {
  owner: string;
  organizationId: OrganizationId;
  target: SessionTarget;
}): string {
  return `${input.owner}|${input.organizationId}|${targetKeyOf(input.target)}`;
}

/** The pool namespace for a session: what `closeSession` sweeps. */
export function poolScopeOf(key: string): string {
  return Bun.hash(key).toString(36);
}

/** The live session under `key`, marked used; null when there is none. */
export function liveSession(key: string): DataSession | null {
  const session = sessions.get(key);
  if (!session) return null;
  session.lastUsedAt = Date.now();
  return session;
}

export function listSessions(owner: string, organizationId: OrganizationId): DataSession[] {
  const mine: DataSession[] = [];
  for (const session of sessions.values()) {
    if (session.owner === owner && session.organizationId === organizationId) mine.push(session);
  }
  return mine;
}

export function closeSession(key: string): boolean {
  const session = sessions.get(key);
  if (!session) return false;
  sessions.delete(key);
  session.tunnel?.close();
  closePools(`res:${key}:`);
  closePools(`conn:${key}:`);
  return true;
}

/** Sessions idle past the limit, closed. Exported for the test; the reaper
 *  calls it once a minute. */
export function evictIdle(now: number, idleMs = SESSION_IDLE_MS): number {
  const stale: string[] = [];
  for (const session of sessions.values()) {
    if (now - session.lastUsedAt > idleMs) stale.push(session.key);
  }
  let closed = 0;
  for (const key of stale) if (closeSession(key)) closed += 1;
  return closed;
}

function startReaper(): void {
  if (reaper !== null) return;
  reaper = setInterval(() => {
    evictIdle(Date.now());
    if (sessions.size === 0 && reaper !== null) {
      clearInterval(reaper);
      reaper = null;
    }
  }, REAP_EVERY_MS);
  // Never hold the process open for this.
  reaper.unref();
}

/** Keep an owner under the cap by closing their least recently used session. */
function makeRoom(owner: string, organizationId: OrganizationId): void {
  const mine = listSessions(owner, organizationId).sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  while (mine.length >= MAX_SESSIONS_PER_OWNER) {
    const oldest = mine.shift();
    if (oldest) closeSession(oldest.key);
  }
}

/** Where a managed database's container is, and the port it listens on
 *  inside it. The container lookup is the one backups and stats use, so a
 *  tenant on a shared server resolves to its host's container. */
async function locateContainer(
  resourceId: ResourceId,
): Promise<Result<{ containerId: string; port: number }, DataError>> {
  const [row] = await db
    .select({ port: databaseResource.internalPort })
    .from(databaseResource)
    .where(eq(databaseResource.resourceId, resourceId))
    .limit(1);
  if (!row) return Result.err(dataError("not_found", `database ${resourceId} not found`));
  const docker = Docker.fromEnv();
  const found = await Result.tryPromise({
    try: () => findResourceContainerId(docker, resourceId),
    catch: (cause) =>
      dataError("unreachable", cause instanceof Error ? cause.message : String(cause)),
  });
  docker.destroy();
  if (found.isErr()) return Result.err(found.error);
  if (found.value === null) {
    return Result.err(dataError("unreachable", "the database container is not running"));
  }
  return Result.ok({ containerId: found.value, port: row.port });
}

/**
 * Open (or join) the caller's session on a target. For a managed database
 * this starts the tunnel; the caller then probes through it and, if the
 * probe fails, closes the session so a dead tunnel never lingers.
 */
export async function openSession(input: {
  owner: string;
  organizationId: OrganizationId;
  target: SessionTarget;
}): Promise<Result<DataSession, DataError>> {
  const key = sessionKey(input);
  const existing = liveSession(key);
  if (existing) return Result.ok(existing);

  let tunnel: Tunnel | null = null;
  if (input.target.kind === "resource") {
    const located = await locateContainer(input.target.resourceId);
    if (located.isErr()) return Result.err(located.error);
    const opened = openTunnel(located.value);
    if (opened.isErr()) return Result.err(opened.error);
    tunnel = opened.value;
  }

  makeRoom(input.owner, input.organizationId);
  const now = Date.now();
  const session: DataSession = {
    key,
    owner: input.owner,
    organizationId: input.organizationId,
    target: input.target,
    tunnel,
    openedAt: now,
    lastUsedAt: now,
  };
  sessions.set(key, session);
  startReaper();
  return Result.ok(session);
}
