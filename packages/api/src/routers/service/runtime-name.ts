/**
 * The name a stored service actually RUNS as, and so the name everything that
 * dials it must use.
 *
 * `service_resource.service_name` is the BASE identity, shared on purpose by a
 * production `web` and a staging `web` (see env-scoped-identity.test.ts). The
 * deploy path suffixes it per environment (`od-shop-web-staging`), so any code
 * that addresses the running workload has to apply the same scope. Writing the
 * base name into a proxy route is what sent a staging hostname to production's
 * container, and destroying by the base name is what left the staging container
 * running after its resource was deleted.
 *
 * Main and unstamped rows resolve to BASE, so production names are unchanged.
 */
import { resolveRuntimeScope } from "../../lib/environment/runtime-scope";
import { runtimeServiceName, type Scope } from "../../lib/environment/scoping";
import { type ServiceRecord } from "./queries";

/** The runtime scope a service deploys under, by its environment. */
export function serviceRuntimeScope(record: ServiceRecord): Promise<Scope> {
  return resolveRuntimeScope(record.resource);
}

/** The container / swarm service name this record runs as. */
export async function serviceRuntimeName(record: ServiceRecord): Promise<string> {
  return runtimeServiceName(record.service.serviceName, await serviceRuntimeScope(record));
}
