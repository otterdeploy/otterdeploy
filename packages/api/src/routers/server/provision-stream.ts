/**
 * Live provisioning-log transport. Onboarding output is ephemeral (no DB
 * table) so we keep a small in-process scrollback ring per active provision and
 * fan lines out over Redis pub/sub: same Bun `RedisClient` mechanism the
 * deployment log tail uses (deployment/log-stream.ts). The runner and the
 * stream handler usually share a process, but going through Redis keeps it
 * correct if the API is ever scaled to more than one instance.
 *
 * Design: docs/designs/server-onboarding.md
 */

import type { ServerId } from "@otterdeploy/shared/id";
import type { RedisClient } from "bun";

import * as z from "zod";

import { createRedis } from "../../lib/redis";

export interface ProvisionLine {
  line: string;
  ts: string;
}

/** Wire schema for lines coming back over pub/sub. We're the sole writer, but
 *  the payload crosses a JSON boundary, so it's parsed rather than cast. */
const provisionLineSchema: z.ZodType<ProvisionLine> = z.object({
  line: z.string(),
  ts: z.string(),
});

const channel = (serverId: ServerId) => `server:${serverId}:provision`;
/** Sentinel line that closes any attached stream, published on terminal. */
const END = "\0OTTER_PROVISION_END";
const RING_MAX = 500;
/** Keep the scrollback ring (including its terminal marker) this long after a
 *  run ends. A fast-failing/-completing run can finish before a just-opened
 *  client subscribes; without the grace window that client replays an empty,
 *  already-deleted ring and hangs forever on a stream that will never emit
 *  again. The DB's provisionStatus is the durable source of truth past this. */
const RING_GRACE_MS = 2 * 60 * 1000;

// Recent lines per in-flight provision, so a client attaching mid-run (or a
// reconnect) replays what it missed. Kept for RING_GRACE_MS past terminal.
const rings = new Map<ServerId, ProvisionLine[]>();
// Pending ring-drop timers: a terminal run schedules one; a fresh run for the
// same server (e.g. a retry) cancels it and starts a clean ring.
const dropTimers = new Map<ServerId, ReturnType<typeof setTimeout>>();

let publisher: RedisClient | null = null;
function getPublisher(): RedisClient {
  publisher ??= createRedis();
  return publisher;
}

function publish(serverId: ServerId, entry: ProvisionLine): void {
  void Promise.resolve()
    .then(() => getPublisher().publish(channel(serverId), JSON.stringify(entry)))
    .catch(() => undefined);
}

/** Append a line to the ring and fan it out live. Fire-and-forget. */
export function emitProvisionLine(serverId: ServerId, line: string): void {
  // A pending drop timer means the previous run for this server already ended;
  // a new emit is therefore a fresh run (e.g. a retry). Cancel the drop and
  // start from a clean ring so old scrollback doesn't bleed into it.
  const pendingDrop = dropTimers.get(serverId);
  if (pendingDrop) {
    clearTimeout(pendingDrop);
    dropTimers.delete(serverId);
    rings.delete(serverId);
  }
  const entry: ProvisionLine = { line, ts: new Date().toISOString() };
  const ring = rings.get(serverId) ?? [];
  ring.push(entry);
  if (ring.length > RING_MAX) ring.shift();
  rings.set(serverId, ring);
  publish(serverId, entry);
}

/**
 * Close every attached stream. Publishes the END sentinel for live readers and
 * appends it to the ring so a client replaying the ring also terminates
 * cleanly. The ring is kept for RING_GRACE_MS (not dropped immediately) so a
 * client that raced the run's finish still replays the full log + terminal
 * marker instead of hanging on an empty, deleted ring.
 */
export function endProvisionStream(serverId: ServerId): void {
  const entry: ProvisionLine = { line: END, ts: new Date().toISOString() };
  const ring = rings.get(serverId) ?? [];
  ring.push(entry);
  if (ring.length > RING_MAX) ring.shift();
  rings.set(serverId, ring);
  publish(serverId, entry);

  const existing = dropTimers.get(serverId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    rings.delete(serverId);
    dropTimers.delete(serverId);
  }, RING_GRACE_MS);
  dropTimers.set(serverId, timer);
}

/**
 * Yield the ring scrollback, then live lines until the END sentinel. Caller is
 * responsible for auth (org owns the server) before invoking.
 */
export async function* streamProvisionLogs(
  serverId: ServerId,
): AsyncGenerator<ProvisionLine, void, undefined> {
  const subscriber = createRedis();
  const ch = channel(serverId);
  const buffer: ProvisionLine[] = [];
  let ended = false;
  let resolveLive: (() => void) | null = null;
  const wake = () => {
    if (resolveLive) {
      const r = resolveLive;
      resolveLive = null;
      r();
    }
  };

  await subscriber.subscribe(ch, (payload) => {
    try {
      const parsed = provisionLineSchema.parse(JSON.parse(payload));
      if (parsed.line === END) ended = true;
      else buffer.push(parsed);
    } catch {
      // Defensive only: we're the sole writer and JSON.stringify.
    }
    wake();
  });

  try {
    // Replay scrollback. A ring that already carries the END marker means the
    // run finished before we subscribed (a fast fail/complete). Yield what it
    // logged, then fall through to a clean end rather than blocking on live
    // lines that will never arrive.
    for (const entry of rings.get(serverId) ?? []) {
      if (entry.line === END) {
        ended = true;
        break;
      }
      yield entry;
    }

    while (!ended || buffer.length > 0) {
      if (buffer.length === 0) {
        if (ended) break;
        await new Promise<void>((res) => {
          resolveLive = res;
        });
        continue;
      }
      const drain = buffer.splice(0, buffer.length);
      for (const entry of drain) yield entry;
    }
  } finally {
    await subscriber.unsubscribe(ch).catch(() => undefined);
    subscriber.close();
  }
}
