/**
 * Server-side implementation of the raw docker events stream.
 *
 * Bridges the docker event bus (process-wide singleton in
 * `swarm/events/subscriber`) to a per-request async generator. Unlike the
 * project stream this one is deliberately unscoped: it is the daemon-level
 * escape hatch behind the install-admin gate, so every event the bus sees is
 * forwarded, flattened into the display-oriented wire shape via
 * `toWireEvent` (see `./events-wire.ts` for the mapping and its tests).
 */

import { subscribeDockerEvents } from "../../swarm";
import { toWireEvent, type DockerWireEvent } from "./events-wire";

export interface DockerEventsStreamInput {
  types?: string[];
}

/**
 * Live tail of the daemon's event feed as a bounded async generator. Same
 * queue discipline as `streamProjectEvents` (routers/project/events-stream.ts):
 * a slow reader drops oldest instead of backpressuring the shared bus, and
 * the abort signal (not `generator.return()`) is what wakes a parked loop
 * on client disconnect (od-664: a parked `await` can't be interrupted, so
 * without the abort listener every closed stream leaked its bus subscription
 * until the next daemon event happened to arrive).
 */
export async function* streamDockerEvents(
  input: DockerEventsStreamInput,
  signal?: AbortSignal,
): AsyncGenerator<DockerWireEvent, void, void> {
  const typeFilter = input.types && input.types.length > 0 ? new Set(input.types) : null;

  const queue: DockerWireEvent[] = [];
  const MAX_QUEUE = 200;
  let resolveNext: (() => void) | null = null;
  let aborted = false;

  const onAbort = () => {
    aborted = true;
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  };
  if (signal?.aborted) aborted = true;
  signal?.addEventListener("abort", onAbort);

  const sub = subscribeDockerEvents((raw) => {
    if (aborted) return;
    const event = toWireEvent(raw);
    if (typeFilter && !typeFilter.has(event.type)) return;
    queue.push(event);
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  });

  try {
    while (!aborted) {
      if (queue.length > 0) {
        const next = queue.shift();
        if (next) yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
    }
  } finally {
    aborted = true;
    signal?.removeEventListener("abort", onAbort);
    sub.close();
  }
}
