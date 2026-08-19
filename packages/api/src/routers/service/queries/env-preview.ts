/**
 * Preview-scoped service env overrides.
 *
 * Split out of `env.ts`: these rows are keyed by (service, preview) and are
 * overlaid by the resolver on top of the base rows: they never surface in the
 * base env editors, views, refs, or manifest state.
 */
import type { PreviewId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { serviceEnvVar } from "@otterdeploy/db/schema/project";
import { and, eq, sql } from "drizzle-orm";
import { createError } from "evlog";

import type { ServiceEnvVarRow } from ".";

import {
  decryptUnsealedEnvRows,
  encryptEnvValue,
} from "../../../lib/env-crypto";

export async function listPreviewServiceEnvVars(
  serviceResourceId: ResourceId,
  previewId: PreviewId,
): Promise<ServiceEnvVarRow[]> {
  const rows = await db
    .select()
    .from(serviceEnvVar)
    .where(
      and(
        eq(serviceEnvVar.serviceResourceId, serviceResourceId),
        eq(serviceEnvVar.previewId, previewId),
      ),
    );
  // Encrypted at rest (od-3pp7); overlay consumers expect plaintext.
  return decryptUnsealedEnvRows(rows);
}

export async function upsertPreviewServiceEnvVar(input: {
  serviceResourceId: ResourceId;
  previewId: PreviewId;
  key: string;
  value: string;
}): Promise<ServiceEnvVarRow> {
  const value = await encryptEnvValue(input.value);
  const [row] = await db
    .insert(serviceEnvVar)
    .values({ ...input, value })
    .onConflictDoUpdate({
      target: [
        serviceEnvVar.serviceResourceId,
        serviceEnvVar.previewId,
        serviceEnvVar.key,
      ],
      targetWhere: sql`preview_id is not null`,
      set: { value, updatedAt: new Date() },
    })
    .returning();
  if (!row) {
    throw createError({
      message: "Failed to upsert preview env override",
      status: 500,
      why: "Database upsert returned no row",
    });
  }
  // Echo the caller's plaintext back (the overrides panel renders it).
  return { ...row, value: input.value };
}

export async function deletePreviewServiceEnvVar(input: {
  serviceResourceId: ResourceId;
  previewId: PreviewId;
  key: string;
}): Promise<boolean> {
  const result = await db
    .delete(serviceEnvVar)
    .where(
      and(
        eq(serviceEnvVar.serviceResourceId, input.serviceResourceId),
        eq(serviceEnvVar.previewId, input.previewId),
        eq(serviceEnvVar.key, input.key),
      ),
    )
    .returning({ id: serviceEnvVar.id });
  return result.length > 0;
}
