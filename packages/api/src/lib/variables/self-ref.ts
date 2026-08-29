/**
 * Save-time detection of a service referencing ITS OWN env bag.
 *
 * `${{postiz.postiz.GOOGLE_GMB_CLIENT_ID}}` saved on the `postiz` child of
 * the `postiz` stack is a reference from a service to itself. The resolver
 * already refuses it: it seeds its cycle guard with the service being
 * resolved, and only the COMPUTED exports (HOST, PORT, URL, DOMAIN,
 * PUBLIC_URL, DOMAINS) survive a self-reference because they derive from the
 * service record rather than its env rows. Anything else is a genuine cycle.
 *
 * The resolver runs at deploy time, though. The Variables tab said "saved",
 * and the operator found out on the next redeploy, from a build-phase error
 * naming two resource ids that happened to be the same id. This check runs
 * at the write, so the answer arrives with the save, in words.
 *
 * Pure: the caller supplies the identity of the service being edited.
 */
import { extractRefs, type RefToken } from "./parser";

/** Exports a service can read about ITSELF without touching its env bag.
 *  Kept in step with `serviceExports` in ./exporters.ts. */
export const COMPUTED_SERVICE_EXPORTS: ReadonlySet<string> = new Set([
  "HOST",
  "PORT",
  "URL",
  "DOMAIN",
  "PUBLIC_URL",
  "DOMAINS",
]);

export interface SelfRefSubject {
  /** The service's resource name (the flat-ref address). */
  resourceName: string;
  /** Owning stack's resource name, or null for a standalone service. */
  stackName: string | null;
  /** The service's compose key within its stack, or null when standalone. */
  composeService: string | null;
}

export interface SelfReference {
  key: string;
  raw: string;
  var: string;
}

function pointsAtSelf(token: RefToken, self: SelfRefSubject): boolean {
  if (!token.stack) return token.resource === self.resourceName;
  if (self.composeService === null || token.resource !== self.composeService) return false;
  // `${{stack.<svc>.VAR}}` is the caller's own stack; `${{<name>.<svc>.VAR}}`
  // has to name it.
  return token.stack.name === null || token.stack.name === self.stackName;
}

/**
 * Every `${{…}}` token in `vars` that reads a NON-computed variable off the
 * service being edited. Empty when the values are safe to save. Values that
 * fail to parse are skipped here: the parse error is reported by the
 * resolver with a position, which is the better message for that case.
 */
export function findSelfReferences(
  vars: ReadonlyArray<{ key: string; value: string }>,
  self: SelfRefSubject,
): SelfReference[] {
  const out: SelfReference[] = [];
  for (const { key, value } of vars) {
    if (!value.includes("${{")) continue;
    for (const token of extractRefs(value)) {
      if (!pointsAtSelf(token, self)) continue;
      if (COMPUTED_SERVICE_EXPORTS.has(token.var)) continue;
      out.push({ key, raw: token.raw, var: token.var });
    }
  }
  return out;
}
