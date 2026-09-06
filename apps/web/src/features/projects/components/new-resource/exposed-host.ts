/**
 * The wizard-side half of "the URL you typed is the URL you get".
 *
 * A stack has one public hostname per exposed service. The wizard seeds each
 * with the address the server would generate anyway and lets the operator
 * overwrite any of them; whatever survives here is what the staged manifest
 * entry publishes on.
 *
 * The compose wizard also auto-fills address-shaped variables (`SERVER_URL`,
 * `NETBIRD_DOMAIN`, …) with the front door's resolved host and remembers that
 * seed on the row (`Var.seedValue`). Editing such a value is still a way to
 * say "publish here", and still lands on the front door, for the templates
 * that declare one.
 */

import { stripToHostname } from "@otterdeploy/shared/public-host";

/**
 * The hostname to publish each exposed `<service>:<port>` on.
 *
 * Explicit per-service entries win. They are seeded with the generated host,
 * so sending them is a no-op until the operator edits one. `editedExposedHost`
 * remains the fallback for the FRONT DOOR only (the first exposed entry): a
 * template that declares an address-shaped variable but whose domain row the
 * operator never touched should still follow the variable they did touch.
 *
 * A key with no usable hostname is omitted rather than sent blank, so the
 * server keeps generating that service's address.
 */
export function exposedHostsFor(
  vars: {
    variables: Array<{ value: string; seedValue?: string }>;
    domains: Array<{ key: string; domain: string }>;
  },
  exposedKeys: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of exposedKeys) {
    const typed = stripToHostname(vars.domains.find((d) => d.key === key)?.domain ?? "");
    if (typed) out[key] = typed;
  }
  const front = exposedKeys[0];
  if (front !== undefined && out[front] === undefined) {
    const edited = editedExposedHost(vars.variables);
    if (edited) out[front] = edited;
  }
  return out;
}

/** The hostname the operator typed over a seeded address variable, or null
 *  when every seed is untouched (the generated host stays canonical). The
 *  server re-normalizes and falls back to the generated host if nothing
 *  usable survives. */
export function editedExposedHost(
  vars: Array<{ value: string; seedValue?: string }>,
): string | null {
  for (const v of vars) {
    if (v.seedValue === undefined || v.value.trim() === "" || v.value === v.seedValue) continue;
    const host = stripToHostname(v.value);
    if (host) return host;
  }
  return null;
}
