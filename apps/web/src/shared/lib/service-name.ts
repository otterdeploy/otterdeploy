/**
 * Platform-generated service-name prefixes — mirror
 * `config.service.serviceNamePrefix` / `networkPrefix` in
 * packages/api/src/constants.ts. The control plane namespaces every swarm
 * service under `otterdeploy-svc-…` (databases under `otterdeploy-…`), but that
 * prefix is noise in the UI: the operator named the service, so show that.
 */
export const PLATFORM_SVC_PREFIX = "otterdeploy-svc-";
const PLATFORM_PREFIX = "otterdeploy-";

/**
 * Strip the platform namespace prefix from a swarm service name for display:
 *   `otterdeploy-svc-course-next` → `course-next`
 *   `otterdeploy-pg-proj-db`      → `pg-proj-db`
 * Names without the prefix (e.g. `system`) pass through untouched.
 */
export function displayServiceName(name: string): string {
  if (name.startsWith(PLATFORM_SVC_PREFIX)) return name.slice(PLATFORM_SVC_PREFIX.length);
  if (name.startsWith(PLATFORM_PREFIX)) return name.slice(PLATFORM_PREFIX.length);
  return name;
}
