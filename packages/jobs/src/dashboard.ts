import { allDeployQueues, getAllQueues } from "./queues";

/**
 * Returns the list of queues to hand to @getworkbench/{hono,…}. Kept here so
 * the dashboard mount in apps/server doesn't need to know about the
 * job registry directly.
 *
 * Async because it also discovers named deploy lane queues from the Redis
 * lane set: the registry alone only knows the default `deploy.triggered`.
 * Discovery runs once at mount, so a lane first used after boot appears on
 * the next server restart.
 */
export async function workbenchQueues() {
  const registryQueues = getAllQueues();
  const seen = new Set(registryQueues.map((q) => q.name));
  const laneQueues = (await allDeployQueues()).filter((q) => !seen.has(q.name));
  return [...registryQueues, ...laneQueues];
}
