import { getAllQueues } from "./queues";

/**
 * Returns the list of queues to hand to @getworkbench/{hono,…}. Kept here so
 * the dashboard mount in apps/server doesn't need to know about the
 * job registry directly.
 */
export function workbenchQueues() {
  return getAllQueues();
}
