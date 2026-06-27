/**
 * Wait-for primitives over the docker event bus.
 *
 * These replace poll loops in consumers — instead of "every 2s, re-query
 * docker until the thing exists", you `await waitForServiceCreate(name)`
 * and the promise resolves the moment docker emits the event. Each helper
 * still takes a deadline so callers can bound the wait without writing
 * their own timeout / cancellation plumbing.
 */

import type { DockerEvent } from "./types";

import { subscribeDockerEvents } from "./subscriber";

interface WaitOptions {
  /** Hard cap. If no matching event fires by then, the promise rejects
   *  with a clear timeout error so callers can render a sensible message
   *  instead of hanging the request. */
  timeoutMs: number;
  /** Optional abort signal — useful for tying the wait to a streaming
   *  request that's already wired to AbortController. */
  signal?: AbortSignal;
}

/**
 * Resolve with the first event matching `predicate`, or reject on timeout
 * / abort. The subscription is torn down before the promise settles so
 * the caller never leaks a listener.
 */
export function waitForEvent<T extends DockerEvent = DockerEvent>(
  predicate: (event: DockerEvent) => event is T,
  options: WaitOptions,
): Promise<T>;
export function waitForEvent(
  predicate: (event: DockerEvent) => boolean,
  options: WaitOptions,
): Promise<DockerEvent>;
export function waitForEvent(
  predicate: (event: DockerEvent) => boolean,
  options: WaitOptions,
): Promise<DockerEvent> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const sub = subscribeDockerEvents((event) => {
      if (settled) return;
      if (!predicate(event)) return;
      finish(() => resolve(event));
    });
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`waitForEvent: timed out after ${options.timeoutMs}ms`)));
    }, options.timeoutMs);
    const onAbort = () => {
      finish(() => reject(new Error("waitForEvent: aborted")));
    };
    options.signal?.addEventListener("abort", onAbort);

    function finish(then: () => void): void {
      if (settled) return;
      settled = true;
      sub.close();
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      then();
    }
  });
}

/** Wait for `service create` event matching the given swarm service name. */
export function waitForServiceCreate(serviceName: string, options: WaitOptions) {
  return waitForEvent(
    (e) => e.kind === "service" && e.action === "create" && e.name === serviceName,
    options,
  );
}

/** Wait for the first container of a swarm service to enter `start`. */
export function waitForServiceContainerStart(swarmServiceId: string, options: WaitOptions) {
  return waitForEvent(
    (e) => e.kind === "container" && e.action === "start" && e.swarmServiceId === swarmServiceId,
    options,
  );
}
