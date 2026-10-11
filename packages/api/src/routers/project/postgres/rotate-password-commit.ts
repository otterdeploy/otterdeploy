/**
 * The transactional half of a password rotation: the row, the
 * rewritten variables and the engine change, all or nothing. See
 * ./rotate-password for the full order and why it is this one.
 */
import type { EnvironmentId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { databaseResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import type { HostRow } from "../../../database-hosting";
import type { HostAdmin, TenantStatement } from "../../../swarm/database-engines/tenancy";
import type { DatabaseResourceRecord } from "../queries";
import type { LiteralRewriteSummary } from "./rotate-password-env";

import { PLATFORM } from "../../../constants";
import { runAdminStatement } from "../../../database-hosting/internals";
import { getEngineAdapter } from "../../../swarm/database-engines";
import {
  passwordRotationPlan,
  POSTGRES_NOW_STATEMENT,
  type RotatableEngine,
} from "../../../swarm/database-engines/password-rotation";
import { MIN_REWRITABLE_PASSWORD_LENGTH, rewriteLiteralPasswords } from "./rotate-password-env";
import { PasswordRotationFailedError } from "./rotate-password-errors";

export interface CommittedRotation {
  rewrite: LiteralRewriteSummary;
  /** Postgres: the engine's clock right after the change, the cut-off for
   *  ending old sessions. Null for other engines or when it could not be
   *  read. */
  cutoff: string | null;
}

/** Where the admin statements run: the HOST for a tenant, the database's
 *  own container otherwise, logged in as `login`. */
export function adminTarget(
  record: DatabaseResourceRecord,
  host: HostRow | null,
  projectSlug: string,
  login: HostAdmin,
): HostRow {
  if (host) return host;
  return {
    resourceId: record.resource.id,
    projectId: record.resource.projectId,
    projectSlug,
    name: record.resource.name,
    engine: record.database.engine,
    admin: login,
    internalHostname: record.database.internalHostname,
    internalPort: record.database.internalPort,
    serviceName: record.database.serviceName,
    volumeName: record.database.volumeName,
    hostResourceId: null,
  };
}

/** Run each statement in order; stops at the first refusal. Ok carries the
 *  last statement's stdout. */
export async function runOnEngine(
  target: HostRow,
  statements: TenantStatement[],
): Promise<Result<string, string>> {
  let stdout = "";
  for (const statement of statements) {
    const ran = await Result.tryPromise({
      try: () => runAdminStatement(target, statement),
      catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
    });
    if (ran.isErr()) return Result.err(ran.error);
    stdout = ran.value;
  }
  return Result.ok(stdout);
}

/**
 * The stored connection string with the new password in place of the old.
 * The password appears verbatim (minted passwords are base64url, which no
 * URL encodes), so a swap keeps whatever shape the stored string has. A row
 * whose string does not carry its own password, or whose password is too
 * short to match safely, is rebuilt from its parts instead.
 */
function swapPassword(stored: string, oldPassword: string, next: string, rebuild: () => string) {
  return oldPassword.length >= MIN_REWRITABLE_PASSWORD_LENGTH && stored.includes(oldPassword)
    ? stored.replaceAll(oldPassword, next)
    : rebuild();
}

function nextConnectionStrings(
  row: typeof databaseResource.$inferSelect,
  next: string,
): { internalConnectionString: string; publicConnectionString: string } {
  const adapter = getEngineAdapter(row.engine);
  const base = { username: row.username, password: next, databaseName: row.databaseName };
  return {
    internalConnectionString: swapPassword(row.internalConnectionString, row.password, next, () =>
      adapter.buildConnectionString({
        ...base,
        host: row.internalHostname,
        port: row.internalPort,
        ...(row.hostResourceId && row.engine === "mongodb" ? { authSource: row.databaseName } : {}),
      }),
    ),
    publicConnectionString: swapPassword(row.publicConnectionString, row.password, next, () =>
      adapter.buildConnectionString({
        ...base,
        host: row.publicHostname,
        port: PLATFORM.database.publicPort,
        sslmode: "require",
        sslnegotiation: "direct",
      }),
    ),
  };
}

/** The login that still works AFTER the change: a tenant's host admin is
 *  untouched; a dedicated database's own login now has the new password. */
function loginAfter(login: HostAdmin, host: HostRow | null, next: string): HostAdmin {
  return host ? login : { ...login, password: next };
}

interface CommitInput {
  record: DatabaseResourceRecord;
  /** Validated up front (rotationTarget), so every plan below exists. */
  engine: RotatableEngine;
  host: HostRow | null;
  projectSlug: string;
  mainEnvironmentId: EnvironmentId | null;
}

/** The plan for one direction of the change, with its admin target. */
function planFor(input: CommitInput, row: typeof databaseResource.$inferSelect, next: string) {
  const plan = passwordRotationPlan({
    engine: input.engine,
    identity: { username: row.username, databaseName: row.databaseName, password: row.password },
    nextPassword: next,
    host: input.host?.admin ?? null,
  });
  return {
    statements: plan.statements,
    target: adminTarget(input.record, input.host, input.projectSlug, plan.login),
    after: adminTarget(
      input.record,
      input.host,
      input.projectSlug,
      loginAfter(plan.login, input.host, next),
    ),
  };
}

/**
 * Commit the rotation: variables, row and engine in one transaction. If the
 * engine took the change and the commit then failed, the engine is put back.
 */
export async function commitRotation(
  input: CommitInput,
  next: string,
  log: RequestLogger,
): Promise<Result<CommittedRotation, PasswordRotationFailedError>> {
  const resourceId = input.record.resource.id;
  const fail = (reason: string) => new PasswordRotationFailedError({ resourceId, reason });
  // Set once the engine has the new password, read after the transaction: a
  // holder object rather than a `let`, so the closure's write is visible.
  const applied: { revert: (() => Promise<Result<string, string>>) | null } = { revert: null };

  const outcome = await Result.tryPromise({
    try: () =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(databaseResource)
          .where(eq(databaseResource.resourceId, resourceId))
          .for("update");
        // Deleted between the request's read and this lock: nothing is
        // written, and the engine is never touched.
        if (!row) throw fail("the database was deleted while the rotation was starting");
        const forward = planFor(input, row, next);

        const rewrite = await rewriteLiteralPasswords(tx, {
          projectId: input.record.resource.projectId,
          mainEnvironmentId: input.mainEnvironmentId,
          oldPassword: row.password,
          newPassword: next,
        });
        await tx
          .update(databaseResource)
          .set({ password: next, ...nextConnectionStrings(row, next) })
          .where(eq(databaseResource.resourceId, resourceId));

        const changed = await runOnEngine(forward.target, forward.statements);
        if (changed.isErr()) throw fail(changed.error);
        const back = planFor(input, { ...row, password: next }, row.password);
        applied.revert = () => runOnEngine(back.target, back.statements);

        const now =
          row.engine === "postgres"
            ? await runOnEngine(forward.after, [POSTGRES_NOW_STATEMENT])
            : null;
        return { rewrite, cutoff: now?.isOk() ? now.value.trim() || null : null };
      }),
    catch: (cause) =>
      cause instanceof PasswordRotationFailedError
        ? cause
        : fail(cause instanceof Error ? cause.message : String(cause)),
  });

  if (outcome.isErr() && applied.revert) {
    const reverted = await applied.revert();
    log.set({
      passwordRotationRevert: reverted.isOk() ? { ok: true } : { ok: false, error: reverted.error },
    });
  }
  return outcome;
}
