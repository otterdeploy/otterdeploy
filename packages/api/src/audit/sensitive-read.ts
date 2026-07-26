/**
 * Audit trail for reads of a secret's VALUE — the most sensitive read in the
 * system (od-5j8.21). Mutations and denials are already audited generically
 * by `traceProcedure` (packages/api/src/index.ts); this covers the other
 * case it deliberately skips: a SUCCESSFUL read that hands back plaintext
 * (an env var value, a decrypted registry password used for a probe, a
 * database connection string with an embedded password).
 *
 * Generalizes the pattern `routers/docker/index.ts` established for
 * container/image/volume/network inspect + log reads: `context.log.set`
 * carries the target (top-level wide-event field), and `context.log.audit`
 * is called with no `target` of its own — the pg-drain's `toAuditRow` falls
 * back to the top-level field (`a.target ?? event.target`) when the audit
 * envelope omits one, so this never needs to satisfy evlog's `AuditTarget`
 * shape (which requires a non-optional `id`) for reads that don't have a
 * single natural id (e.g. a bulk org-wide catalog read).
 */
import type { Context } from "../context";

export function auditSensitiveRead(
  context: Context,
  action: string,
  target: { type: string; [key: string]: unknown },
): void {
  context.log.set({ target });
  const user = context.session?.user;
  const actor = user
    ? { type: "user" as const, id: user.id, email: user.email }
    : context.apiKey
      ? { type: "api" as const, id: context.apiKey.id }
      : null;
  if (!actor) return;
  context.log.audit?.({
    action,
    actor,
    outcome: "success",
    correlationId: context.correlationId,
  });
}
