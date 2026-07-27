/**
 * Turn a Postgres unique-constraint violation into a 409 the UI can act on.
 *
 * Every uniqueness rule in the schema — resource names, proxy-route domains,
 * project/environment slugs, certificate hostnames — was enforced only by the
 * index. A collision therefore escaped as a raw `DrizzleQueryError`, which the
 * transport rendered as a 500 *with the full INSERT statement and its bound
 * parameters copied into the audit log*. The operator saw "500", the log grew a
 * SQL dump, and nothing said "that name is taken".
 *
 * This is the backstop, not the primary defence: forms should check a name
 * before submitting and seed a default that doesn't collide. But a check-then-
 * insert is inherently racy, so the constraint has to stay authoritative and its
 * violation has to read like validation rather than a crash.
 *
 * Sits at the base of the procedure ladder (see ../index.ts) so it wraps every
 * handler exactly once.
 */

import { ORPCError, os as orpc } from "@orpc/server";

import type { Context } from "../context";

/** Postgres SQLSTATE for unique_violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * Constraint name → operator-facing message. Anything not listed still becomes
 * a 409 rather than a 500; it just gets the generic wording, so adding an index
 * can never regress to leaking SQL.
 */
const CONSTRAINT_MESSAGES: Readonly<Record<string, string>> = {
  resource_project_name_base_unique: "A resource with that name already exists in this project.",
  resource_project_name_preview_unique: "A resource with that name already exists in this preview.",
  proxy_route_domain_unique: "That domain is already routed to another service.",
  project_org_slug_unique: "A project with that slug already exists.",
  environment_project_slug_unique: "An environment with that slug already exists in this project.",
  custom_certificate_org_hostname_unique: "A certificate for that hostname already exists.",
  database_resource_public_hostname_unique: "That public hostname is already in use.",
  database_ephemeral_credential_role_unique: "That database role already exists.",
};

interface PgLikeError {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
}

/**
 * Find a unique violation anywhere in the cause chain, since drizzle wraps the
 * driver error (and better-result may wrap that again). Depth-capped so a
 * self-referential cause can't spin.
 */
export function findUniqueViolation(err: unknown): { constraint: string | null } | null {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current != null; depth++) {
    const candidate = current as PgLikeError;
    if (candidate.code === UNIQUE_VIOLATION) {
      return { constraint: typeof candidate.constraint === "string" ? candidate.constraint : null };
    }
    current = candidate.cause;
  }
  return null;
}

/** The message for a violated constraint; generic when it isn't mapped. */
export function conflictMessage(constraint: string | null): string {
  if (constraint && constraint in CONSTRAINT_MESSAGES) {
    // eslint-disable-next-line security/detect-object-injection -- guarded by `in`
    return CONSTRAINT_MESSAGES[constraint] as string;
  }
  return "That value is already taken. Choose a different one.";
}

export const uniqueViolationProcedure = orpc.$context<Context>().middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    const hit = findUniqueViolation(error);
    // Not a collision — leave it exactly as it was, including its stack.
    if (!hit) throw error;
    throw new ORPCError("CONFLICT", { message: conflictMessage(hit.constraint) });
  }
});
