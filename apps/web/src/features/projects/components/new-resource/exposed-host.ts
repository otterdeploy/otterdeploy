/**
 * The wizard-side half of "the URL you typed is the URL you get".
 *
 * The compose wizard auto-fills address-shaped variables (`NETBIRD_DOMAIN`,
 * `SERVER_URL`, …) with the stack's resolved public host and remembers that
 * seed on the row (`Var.seedValue`). If the operator edits such a value, the
 * hostname they typed becomes the exposed front service's public domain in
 * the staged manifest entry — otherwise the route would publish on the
 * name-derived generated host while the app's own config points elsewhere.
 */

import { stripToHostname } from "@otterdeploy/shared/public-host";

/**
 * The hostname to publish the exposed front service on.
 *
 * The explicit domain field wins: it is seeded with the host the server would
 * generate, so sending it is a no-op until the operator edits it, and it is the
 * only control a template without an address-shaped variable has.
 * `editedExposedHost` stays as the fallback for the templates that do declare
 * one, where editing the variable is still the natural gesture.
 */
export function exposedHostFor(vars: {
  variables: Array<{ value: string; seedValue?: string }>;
  domain: string;
}): string | null {
  const typed = stripToHostname(vars.domain);
  if (typed) return typed;
  return editedExposedHost(vars.variables);
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
