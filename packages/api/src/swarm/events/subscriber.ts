/**
 * Singleton subscriber for the docker `/events` stream.
 *
 * Why a singleton: each connection holds a long-lived HTTP request against
 * the docker daemon. Without sharing, every consumer (UI streams, the
 * boot-log waiter, the future reconciler) would open its own — wasting
 * file descriptors and forcing the daemon to serialize every event N
 * times. Instead we keep ONE upstream connection and fan events out to
 * subscribers via an EventEmitter.
 *
 * Lazy lifecycle: the connection opens on the first `subscribe()` call
 * and stays open as long as there's at least one listener. When the last
 * listener calls `close()`, we keep the connection alive briefly (so a
 * burst of subscribe/unsubscribe doesn't churn the daemon) and only tear
 * it down after a quiet window.
 *
 * Reconnect: docker can drop the events stream for any reason (daemon
 * restart, network hiccup, swarm leadership change). The reader loop
 * catches stream-end and reconnects with exponential backoff capped at
 * 30s. There's no replay — consumers should treat the subscriber as
 * best-effort and reconcile from current docker state when they need
 * authoritative answers (snapshot-then-watch pattern).
 */

import { EventEmitter } from "node:events";

import { Docker } from "@otterdeploy/docker";
import { log } from "evlog";

import { readLines } from "../stream-parse";

import { normalizeDockerEvent } from "./normalize";
import type { DockerEvent } from "./types";

type Listener = (event: DockerEvent) => void;

const EVENT_NAME = "event";
const IDLE_SHUTDOWN_MS = 15_000;
const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

class DockerEventBus {
  private readonly emitter = new EventEmitter();
  private docker: Docker | null = null;
  private stream: NodeJS.ReadableStream | null = null;
  private connected = false;
  /** Number of subscribe() callers minus close() callers. The connection
   *  follows this — opens on 0→1, closes (after a quiet window) on N→0. */
  private listenerCount = 0;
  private backoffMs = MIN_BACKOFF_MS;
  private idleShutdownTimer: NodeJS.Timeout | null = null;
  /** Stops the reader loop's recursive reconnect when we want a clean
   *  teardown — set by stop(), checked by the loop. */
  private shouldRun = false;

  /** Increase emitter's listener cap — we don't want spurious "memory
   *  leak" warnings from the (intentionally many) per-request consumers. */
  constructor() {
    this.emitter.setMaxListeners(0);
  }

  subscribe(listener: Listener): { close: () => void } {
    this.emitter.on(EVENT_NAME, listener);
    this.listenerCount += 1;
    if (this.idleShutdownTimer) {
      clearTimeout(this.idleShutdownTimer);
      this.idleShutdownTimer = null;
    }
    if (!this.connected && !this.shouldRun) {
      this.shouldRun = true;
      void this.runReaderLoop();
    }
    let closed = false;
    return {
      close: () => {
        if (closed) return;
        closed = true;
        this.emitter.off(EVENT_NAME, listener);
        this.listenerCount = Math.max(0, this.listenerCount - 1);
        if (this.listenerCount === 0) this.scheduleIdleShutdown();
      },
    };
  }

  /** True when there's at least one live listener — useful for tests and
   *  for the rare consumer that wants to know whether events will flow. */
  get hasSubscribers(): boolean {
    return this.listenerCount > 0;
  }

  // Reader loop: connect → drain → reconnect-with-backoff. Runs until
  // shouldRun flips false (no subscribers left and the idle window expired)
  // OR the process exits. Caught errors are logged and reconnected.
  private async runReaderLoop(): Promise<void> {
    while (this.shouldRun) {
      const established = await this.connect();
      if (!established) {
        await this.sleep(this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
        continue;
      }
      // We got a live stream — reset backoff for the next failure.
      this.backoffMs = MIN_BACKOFF_MS;
      await this.drain();
      // drain() resolves on stream end (EOF or error). Tear down and try
      // again unless we've been asked to stop.
      this.cleanupConnection();
      if (this.shouldRun) {
        await this.sleep(this.backoffMs);
      }
    }
    this.cleanupConnection();
  }

  private async connect(): Promise<boolean> {
    const docker = Docker.fromEnv();
    const result = await docker.system.events();
    if (result.isErr()) {
      log.warn({
        dockerEvents: { phase: "connect", error: result.error.message },
      });
      docker.destroy();
      return false;
    }
    this.docker = docker;
    this.stream = result.value;
    this.connected = true;
    log.info({ dockerEvents: { phase: "connected" } });
    return true;
  }

  private async drain(): Promise<void> {
    const stream = this.stream;
    if (!stream) return;
    try {
      for await (const line of readLines(stream)) {
        this.dispatch(line);
      }
    } catch (err) {
      log.warn({
        dockerEvents: {
          phase: "drain",
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  private dispatch(line: string): void {
    try {
      const parsed = JSON.parse(line) as Parameters<typeof normalizeDockerEvent>[0];
      const event = normalizeDockerEvent(parsed);
      this.emitter.emit(EVENT_NAME, event);
    } catch {
      // Malformed line — daemon sometimes batches partial JSON or sends
      // status lines we don't care about. Skip without spamming logs.
    }
  }

  private cleanupConnection(): void {
    if (this.stream) {
      try {
        (this.stream as { destroy?: () => void }).destroy?.();
      } catch {
        // Best-effort — the reader loop has already moved on.
      }
    }
    if (this.docker) {
      try {
        this.docker.destroy();
      } catch {
        // ditto
      }
    }
    this.stream = null;
    this.docker = null;
    this.connected = false;
  }

  private scheduleIdleShutdown(): void {
    if (this.idleShutdownTimer) return;
    this.idleShutdownTimer = setTimeout(() => {
      this.idleShutdownTimer = null;
      if (this.listenerCount === 0) {
        this.shouldRun = false;
        this.cleanupConnection();
        log.info({ dockerEvents: { phase: "idle-shutdown" } });
      }
    }, IDLE_SHUTDOWN_MS);
    // Don't hold the event loop open just for the shutdown timer.
    this.idleShutdownTimer.unref?.();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Process-wide singleton. apps/server imports through the swarm barrel, so
// there's exactly one instance per node process — which is what we want
// because there's exactly one docker daemon per node.
const bus = new DockerEventBus();

/**
 * Subscribe to the docker event stream. Returns a `close` to unregister.
 * The subscriber starts the upstream connection on first call and
 * gracefully tears it down when the last listener leaves.
 *
 * Order guarantee: events are emitted in the order docker sends them on a
 * single connection. After a reconnect there's a gap — consumers that
 * need full coverage across reconnects should snapshot the relevant
 * docker state when they start and after each reconnect (which they can
 * detect via the gap in event timestamps).
 */
export function subscribeDockerEvents(listener: Listener): { close: () => void } {
  return bus.subscribe(listener);
}

/**
 * Predicate-filtered subscribe. Convenience wrapper for the common case
 * of "I only care about service.create events for THIS service name".
 * Keeps the per-listener filter cheap — the bus emits to every listener
 * regardless, so push the predicate down rather than allocating N times.
 */
export function subscribeDockerEventsWhere<T extends DockerEvent = DockerEvent>(
  predicate: (event: DockerEvent) => event is T,
  listener: (event: T) => void,
): { close: () => void };
export function subscribeDockerEventsWhere(
  predicate: (event: DockerEvent) => boolean,
  listener: Listener,
): { close: () => void };
export function subscribeDockerEventsWhere(
  predicate: (event: DockerEvent) => boolean,
  listener: Listener,
): { close: () => void } {
  return subscribeDockerEvents((event) => {
    if (predicate(event)) listener(event);
  });
}
