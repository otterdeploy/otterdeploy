import { TaggedError } from "better-result";

import { type Id, ID_PREFIX } from "@otterdeploy/shared/id";

export type EnvironmentId = Id<typeof ID_PREFIX.environment>;

export class EnvironmentNotFoundError extends TaggedError(
  "EnvironmentNotFoundError",
)<{
  message: string;
  environmentId: EnvironmentId;
}>() {
  constructor(args: { environmentId: EnvironmentId }) {
    super({
      environmentId: args.environmentId,
      message: `environment ${args.environmentId} not found`,
    });
  }
}

export class EnvironmentConflictError extends TaggedError(
  "EnvironmentConflictError",
)<{
  message: string;
  slug: string;
}>() {
  constructor(args: { slug: string }) {
    super({
      slug: args.slug,
      message: `environment with slug "${args.slug}" already exists`,
    });
  }
}

/**
 * Unexpected DB-side failure during env insert (FK violation, missing
 * required column, transient connection error, etc.). Carries the
 * stringified underlying cause so handlers can log it and the operator
 * sees what actually broke instead of a generic "DB error" line.
 */
export class EnvironmentDatabaseError extends TaggedError(
  "EnvironmentDatabaseError",
)<{
  message: string;
  cause: string;
  pgCode: string | null;
  pgDetail: string | null;
  pgConstraint: string | null;
  pgTable: string | null;
}>() {
  constructor(args: { cause: unknown }) {
    const summary = describePgError(args.cause);
    super({
      cause: summary.cause,
      pgCode: summary.pgCode,
      pgDetail: summary.pgDetail,
      pgConstraint: summary.pgConstraint,
      pgTable: summary.pgTable,
      message: `env database error: ${summary.cause}`,
    });
  }
}

/**
 * Drizzle wraps postgres-js errors with the SQL text as the outer message
 * ("Failed query: insert into …") and stashes the real PostgresError on
 * `.cause`. The PostgresError carries the actually useful diagnostics:
 *   - code: SQLSTATE (e.g. "23503" foreign_key_violation, "23505" unique_violation)
 *   - detail: human description like 'Key (project_id)=(...) is not present in table "project".'
 *   - constraint_name, table_name, column_name, etc.
 * We surface all of these so the operator log line spells out exactly what
 * postgres rejected and why.
 */
function describePgError(err: unknown): {
  cause: string;
  pgCode: string | null;
  pgDetail: string | null;
  pgConstraint: string | null;
  pgTable: string | null;
} {
  const outerMessage =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : JSON.stringify(err);
  const pg =
    err && typeof err === "object" && "cause" in err
      ? (err as { cause?: unknown }).cause
      : null;
  if (!pg || typeof pg !== "object") {
    return {
      cause: outerMessage,
      pgCode: null,
      pgDetail: null,
      pgConstraint: null,
      pgTable: null,
    };
  }
  const p = pg as Record<string, unknown>;
  const pick = (k: string): string | null =>
    typeof p[k] === "string" ? (p[k] as string) : null;
  const code = pick("code");
  const detail = pick("detail");
  const constraint = pick("constraint_name") ?? pick("constraint");
  const table = pick("table_name") ?? pick("table");
  const pgMessage = pick("message");
  const cause = [
    code ? `[${code}]` : null,
    pgMessage ?? outerMessage,
    detail,
    constraint ? `constraint=${constraint}` : null,
    table ? `table=${table}` : null,
  ]
    .filter((s): s is string => Boolean(s))
    .join(" — ");
  return {
    cause: cause || outerMessage,
    pgCode: code,
    pgDetail: detail,
    pgConstraint: constraint,
    pgTable: table,
  };
}
