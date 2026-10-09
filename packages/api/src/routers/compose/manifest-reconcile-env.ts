import type { ComposeManifest } from "../../stack/manifest";
import type { StackVariableSeed } from "./stack-env";

import { SECRETISH } from "./util";

/**
 * The stack's `${VAR}` values from its manifest entry, as seeds for the
 * stack's OWN variables (written with the stack row by createComposeRecord).
 *
 * They used to be seeded into the project variables, ONE flat namespace that
 * every stack in the project interpolates against. Template variable names
 * are generic: `POSTGRES_PASSWORD`, `JWT_SECRET`, `SECRET_KEY`,
 * `NEXTAUTH_SECRET` are each wanted by a dozen templates. Writing them there
 * meant installing (or reinstalling) one stack rotated a credential another
 * stack was running on. A later "seed, never overwrite" guard stopped the
 * rotation, but only by silently handing the new stack the OTHER stack's
 * credential instead of the one it generated. Observed 2026-08-29 on a live
 * Postiz + cal-com project.
 *
 * A stack now owns its variables: the install writes here and only
 * here, and a same-named project variable is left exactly as it was. The
 * stack's own value wins for this stack; every other stack keeps reading what
 * it read before.
 */
export function manifestStackVariables(spec: ComposeManifest): StackVariableSeed[] {
  return Object.entries(spec.env ?? {}).map(([key, value]) => ({
    key,
    value,
    isSecret: SECRETISH.test(key),
  }));
}
