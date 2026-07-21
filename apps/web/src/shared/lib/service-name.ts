/**
 * Platform-generated service-name prefixes — mirror
 * `config.service.serviceNamePrefix` / `networkPrefix` in
 * packages/api/src/constants.ts. The control plane namespaces every swarm
 * service under `od-…` (databases under `otterdeploy-…`), but that prefix is
 * noise in the UI: the operator named the service, so show that.
 */
export const PLATFORM_SVC_PREFIX = "od-";
// Pre-rename services persisted their name with the old prefix; keep stripping
// it so they still display cleanly until they're next redeployed.
const LEGACY_SVC_PREFIX = "otterdeploy-svc-";
const PLATFORM_PREFIX = "otterdeploy-";

/**
 * Strip the platform namespace prefix from a swarm service name for display:
 *   `od-course-next`             → `course-next`
 *   `otterdeploy-svc-course-next`→ `course-next`   (legacy)
 *   `otterdeploy-pg-proj-db`     → `pg-proj-db`
 * Names without the prefix (e.g. `system`) pass through untouched.
 */
export function displayServiceName(name: string): string {
  // Legacy service prefix before the generic db prefix — `otterdeploy-svc-`
  // also starts with `otterdeploy-`, so the more specific one must win.
  if (name.startsWith(LEGACY_SVC_PREFIX)) return name.slice(LEGACY_SVC_PREFIX.length);
  if (name.startsWith(PLATFORM_SVC_PREFIX)) return name.slice(PLATFORM_SVC_PREFIX.length);
  if (name.startsWith(PLATFORM_PREFIX)) return name.slice(PLATFORM_PREFIX.length);
  return name;
}
