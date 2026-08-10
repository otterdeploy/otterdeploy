import type { JsonObject } from "@otterdeploy/shared/json";
import type { AuditFields } from "evlog";

/**
 * Before/after diffs for the audit trail's `changes` column.
 *
 * The column, the drain mapping and the schema comment citing evlog's
 * `auditDiff` all existed; nothing ever populated it. Every mutation row
 * therefore said *that* `service.update` ran and never *what it changed*, which
 * for scaling, domains, env vars and firewall rules is the only part an auditor
 * actually asks about.
 *
 * ## How a handler contributes one
 *
 * ```ts
 * const before = await loadServiceSettings(id);
 * const after = await applyServiceSettings(id, input);
 * recordAuditChanges(context, { before, after });
 * ```
 *
 * The oRPC `traceProcedure` middleware reads whatever the handler left behind
 * and folds it into the audit envelope it was already emitting, so a handler
 * never has to know the envelope exists.
 *
 * ## Why a draft object rather than a context field
 *
 * The middleware runs *around* the handler: it must read the diff after
 * `next()` resolves. Inner middlewares are free to build a new context object
 * (that is what `next({ context })` does), so a field the handler assigns on
 * *its* context may not be the field the outer middleware holds. A mutable
 * draft passed by reference survives any number of shallow merges — both
 * layers point at the same object. It is created per procedure invocation, not
 * per request, so two calls in one request can never inherit each other's diff.
 */
import { auditDiff } from "evlog";

/** Mutable per-invocation slot the middleware injects and the handler fills. */
export interface AuditDraft {
  changes?: AuditFields["changes"];
}

/**
 * Key names whose values never reach the audit trail.
 *
 * The audit table is readable by operators and kept for 90 days, so a secret
 * that lands here outlives and outspreads the store it came from. Env-var
 * writes are the motivating case: the *names* that changed are exactly what an
 * auditor needs, and the values are exactly what they must not get. Matching is
 * on the key name at any depth (evlog's `redactPaths` semantics), so a nested
 * `env.DATABASE_URL.value` is covered by `value`.
 */
const REDACTED_KEYS = [
  "value",
  "password",
  "secret",
  "token",
  "accessToken",
  "refreshToken",
  "privateKey",
  "publicKey",
  "key",
  "apiKey",
  "credential",
  "credentials",
  "content",
  "sshKey",
  "certificate",
  "cert",
  "dsn",
  "url",
  "connectionString",
] as const;

export interface RecordChangesOptions {
  /** Extra key names to redact on top of {@link REDACTED_KEYS}. */
  redactPaths?: string[];
  /**
   * Keep the full (redacted) snapshots alongside the patch. Off by default:
   * the patch alone answers "what changed", and whole-object snapshots on every
   * mutation are what turns an audit table into a copy of the database.
   */
  includeSnapshots?: boolean;
}

/**
 * Compute the diff and leave it for the middleware. Safe to call from any
 * handler: with no draft on the context (a non-oRPC caller, or a test) it is a
 * no-op rather than an error.
 */
export function recordAuditChanges(
  context: { auditDraft?: AuditDraft },
  { before, after }: { before: unknown; after: unknown },
  options: RecordChangesOptions = {},
): void {
  const draft = context.auditDraft;
  if (!draft) return;
  const diff = auditDiff(before, after, {
    redactPaths: [...REDACTED_KEYS, ...(options.redactPaths ?? [])],
    includeBefore: options.includeSnapshots ?? false,
    includeAfter: options.includeSnapshots ?? false,
  });
  // An update that changed nothing still deserves its row — it says someone
  // tried — but an empty patch adds nothing, so leave `changes` null.
  if (diff.patch.length === 0) return;
  draft.changes = diff;
}

/**
 * Record a key-level diff over a map whose values must never be stored — env
 * vars, and anything else shaped like a secret bag.
 *
 * The generic path would depend on a key name matching {@link REDACTED_KEYS};
 * here no value is handed to a differ at all. Values are compared in memory and
 * only key names are emitted, so the row reads "added FOO, removed BAR, changed
 * BAZ" and cannot leak a secret even if the redact list misses a name.
 *
 * Rotations are the case worth being careful about: reducing each side to
 * "set"/"empty" independently would make a rotated value produce no patch entry
 * at all, hiding exactly the event most worth auditing. Comparing the values
 * (and then discarding them) is what makes `replace` appear.
 *
 * A hash of the value would be a verifier for a low-entropy secret, so presence
 * and inequality is as far as this goes.
 */
export function recordSecretMapChanges(
  context: { auditDraft?: AuditDraft },
  { before, after }: { before: JsonObject; after: JsonObject },
): void {
  const draft = context.auditDraft;
  if (!draft) return;

  const patch: Array<{ op: "add" | "remove" | "replace"; path: string }> = [];
  for (const key of Object.keys(after)) {
    if (!(key in before)) patch.push({ op: "add", path: `/${key}` });
    else if (before[key] !== after[key]) patch.push({ op: "replace", path: `/${key}` });
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) patch.push({ op: "remove", path: `/${key}` });
  }

  if (patch.length === 0) return;
  // Sorted so the same edit produces the same row regardless of key order.
  patch.sort((a, b) => a.path.localeCompare(b.path) || a.op.localeCompare(b.op));
  draft.changes = { patch } as AuditFields["changes"];
}
