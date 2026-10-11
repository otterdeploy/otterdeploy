/**
 * The stored variables a password rotation has to rewrite.
 *
 * A `${{db.DATABASE_URL}}` reference needs nothing here: it resolves from the
 * database row at deploy time, so rolling the service is enough. What does
 * need rewriting is every place the OLD password was written down verbatim:
 *
 *   - manifest refs. `${database:db.password}` / `.url` are substituted at
 *     APPLY time (manifest-apply-refs.ts), so the service row holds the
 *     plaintext password, not the reference;
 *   - a value an operator pasted by hand (a connection string copied out of
 *     the panel into a variable).
 *
 * Both stop working the moment the engine changes, so replacing the old
 * password with the new one is strictly better than leaving them. The match is
 * on the password itself, which the platform mints as 24 random base64url
 * characters: a value containing it contains THIS credential. A password too
 * short to be that unambiguous (a row imported from elsewhere) is not matched
 * at all rather than risk rewriting unrelated text.
 *
 * Sealed rows are rewritten too: their plaintext never leaves the server, and
 * this runs on the server; skipping them would leave a sealed secret broken.
 */
import type { EnvironmentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import {
  composeResource,
  projectEnvSubscription,
  projectEnvVar,
  resource,
  serviceEnvVar,
  stackEnvVar,
} from "@otterdeploy/db/schema/project";
import { and, eq, inArray, isNull } from "drizzle-orm";

import type { RouteTx } from "../../../caddy/queries";

import { decryptEnvValue, encryptEnvValue } from "../../../lib/env-crypto";

/** Below this, a substring match could hit unrelated text. Minted passwords
 *  are 24 characters. */
export const MIN_REWRITABLE_PASSWORD_LENGTH = 16;

export interface LiteralRewriteSummary {
  /** How many stored values were rewritten, across every table. */
  rewritten: number;
  /** Services whose OWN variables (base rows) were rewritten. */
  services: ResourceId[];
  /** Services subscribed to a rewritten project variable. */
  subscribers: ResourceId[];
}

export interface RewriteInput {
  projectId: ProjectId;
  /** The project's main environment, which owns unstamped rows. */
  mainEnvironmentId: EnvironmentId | null;
  oldPassword: string;
  newPassword: string;
}

/** The rows among `rows` whose plaintext carries `oldPassword`, re-encrypted
 *  with `newPassword` in its place. */
async function rewrite<Id extends string>(
  rows: Array<{ id: Id; value: string }>,
  oldPassword: string,
  newPassword: string,
): Promise<Array<{ id: Id; value: string }>> {
  const out: Array<{ id: Id; value: string }> = [];
  for (const row of rows) {
    const plain = await decryptEnvValue(row.value);
    if (!plain.includes(oldPassword)) continue;
    out.push({
      id: row.id,
      value: await encryptEnvValue(plain.replaceAll(oldPassword, newPassword)),
    });
  }
  return out;
}

async function rewriteServiceVars(
  tx: RouteTx,
  projectId: ProjectId,
  oldPassword: string,
  newPassword: string,
) {
  const rows = await tx
    .select({
      id: serviceEnvVar.id,
      value: serviceEnvVar.value,
      serviceResourceId: serviceEnvVar.serviceResourceId,
      previewId: serviceEnvVar.previewId,
    })
    .from(serviceEnvVar)
    .innerJoin(resource, eq(resource.id, serviceEnvVar.serviceResourceId))
    .where(eq(resource.projectId, projectId));
  const changed = await rewrite(rows, oldPassword, newPassword);
  const services = new Set<ResourceId>();
  for (const next of changed) {
    await tx.update(serviceEnvVar).set({ value: next.value }).where(eq(serviceEnvVar.id, next.id));
    const row = rows.find((r) => r.id === next.id);
    // A preview override changes what that preview resolves; the base roll
    // below is for base rows only.
    if (row && row.previewId === null) services.add(row.serviceResourceId);
  }
  return { rewritten: changed.length, services: [...services] };
}

async function rewriteProjectVars(tx: RouteTx, input: RewriteInput) {
  const { projectId, oldPassword, newPassword } = input;
  const rows = await tx
    .select({
      id: projectEnvVar.id,
      value: projectEnvVar.value,
      key: projectEnvVar.key,
      environmentId: projectEnvVar.environmentId,
    })
    .from(projectEnvVar)
    .where(eq(projectEnvVar.projectId, projectId));
  const changed = await rewrite(rows, oldPassword, newPassword);
  const touched: Array<{ key: string; environmentId: EnvironmentId }> = [];
  for (const next of changed) {
    await tx.update(projectEnvVar).set({ value: next.value }).where(eq(projectEnvVar.id, next.id));
    const row = rows.find((r) => r.id === next.id);
    if (row) touched.push({ key: row.key, environmentId: row.environmentId });
  }
  return { rewritten: changed.length, subscribers: await subscribersOf(tx, input, touched) };
}

/** Base services in the variable's own environment that subscribe to it. An
 *  unstamped service row belongs to main (see inEnvironmentScope). */
async function subscribersOf(
  tx: RouteTx,
  input: RewriteInput,
  touched: Array<{ key: string; environmentId: EnvironmentId }>,
): Promise<ResourceId[]> {
  const { projectId, mainEnvironmentId } = input;
  if (touched.length === 0) return [];
  const rows = await tx
    .select({
      serviceResourceId: projectEnvSubscription.serviceResourceId,
      key: projectEnvSubscription.projectEnvKey,
      environmentId: resource.environmentId,
    })
    .from(projectEnvSubscription)
    .innerJoin(resource, eq(resource.id, projectEnvSubscription.serviceResourceId))
    .where(
      and(
        eq(resource.projectId, projectId),
        isNull(resource.previewId),
        inArray(
          projectEnvSubscription.projectEnvKey,
          touched.map((t) => t.key),
        ),
      ),
    );
  const out = new Set<ResourceId>();
  for (const row of rows) {
    const environmentId = row.environmentId ?? mainEnvironmentId;
    if (touched.some((t) => t.key === row.key && t.environmentId === environmentId)) {
      out.add(row.serviceResourceId);
    }
  }
  return [...out];
}

async function rewriteStackVars(
  tx: RouteTx,
  projectId: ProjectId,
  oldPassword: string,
  newPassword: string,
) {
  // A stack's own variables seed its children's rows once; the children's
  // rows are rewritten (and rolled) above. These are rewritten so the next
  // stack deploy does not seed the old password back.
  const rows = await tx
    .select({ id: stackEnvVar.id, value: stackEnvVar.value })
    .from(stackEnvVar)
    .innerJoin(composeResource, eq(composeResource.resourceId, stackEnvVar.stackResourceId))
    .innerJoin(resource, eq(resource.id, composeResource.resourceId))
    .where(eq(resource.projectId, projectId));
  const changed = await rewrite(rows, oldPassword, newPassword);
  for (const next of changed) {
    await tx.update(stackEnvVar).set({ value: next.value }).where(eq(stackEnvVar.id, next.id));
  }
  return changed.length;
}

/**
 * Replace `oldPassword` with `newPassword` in every stored variable of the
 * project, inside the rotation's transaction. A short password matches
 * nothing (see MIN_REWRITABLE_PASSWORD_LENGTH).
 */
export async function rewriteLiteralPasswords(
  tx: RouteTx,
  input: RewriteInput,
): Promise<LiteralRewriteSummary> {
  if (input.oldPassword.length < MIN_REWRITABLE_PASSWORD_LENGTH) {
    return { rewritten: 0, services: [], subscribers: [] };
  }
  const service = await rewriteServiceVars(
    tx,
    input.projectId,
    input.oldPassword,
    input.newPassword,
  );
  const shared = await rewriteProjectVars(tx, input);
  const stack = await rewriteStackVars(tx, input.projectId, input.oldPassword, input.newPassword);
  return {
    rewritten: service.rewritten + shared.rewritten + stack,
    services: service.services,
    subscribers: shared.subscribers,
  };
}
