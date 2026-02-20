import { and, db, eq } from "@otterdeploy/db";
import {
  secretProviderBinding,
  secretReference,
} from "@otterdeploy/db/schema/secrets";

import type { BindingRef } from "./provider";
import type {
  SecretKind,
  UpsertSecretInput,
} from "./types";
import { buildProviderPath, createSecretId, getProviderClient } from "./utils";

export async function ensureOrganizationSecretBinding(organizationId: string) {
  const existing = await db.query.secretProviderBinding.findFirst({
    where: eq(secretProviderBinding.organizationId, organizationId),
  });

  if (existing?.status === "active") {
    return existing;
  }

  const provider = existing?.provider ?? "infisical";
  const client = getProviderClient(provider);
  const ensured = await client.ensureOrganizationBinding(organizationId);

  const now = new Date();

  if (existing) {
    await db
      .update(secretProviderBinding)
      .set({
        providerProjectId: ensured.providerProjectId,
        providerProjectSlug: ensured.providerProjectSlug,
        status: "active",
        updatedAt: now,
      })
      .where(eq(secretProviderBinding.id, existing.id));

    const refreshed = await db.query.secretProviderBinding.findFirst({
      where: eq(secretProviderBinding.id, existing.id),
    });
    if (!refreshed) {
      throw new Error("Secret provider binding disappeared during update");
    }
    return refreshed;
  }

  const row = {
    id: createSecretId(),
    organizationId,
    provider: "infisical" as const,
    providerProjectId: ensured.providerProjectId,
    providerProjectSlug: ensured.providerProjectSlug,
    status: "active" as const,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(secretProviderBinding).values(row);
  return row;
}

type UpsertSecretReferenceResult = {
  reference: typeof secretReference.$inferSelect;
  providerVersion: string | null;
  providerPath: string;
  providerKey: string;
};

export async function upsertSecretReference(
  input: UpsertSecretInput,
): Promise<UpsertSecretReferenceResult> {
  const binding = await ensureOrganizationSecretBinding(input.organizationId);
  const providerClient = getProviderClient(binding.provider);

  const providerPath = buildProviderPath(
    binding.providerProjectSlug,
    input.logicalScope,
    input.logicalScopeId,
  );

  const providerResult = await providerClient.upsertSecret({
    binding: {
      organizationId: input.organizationId,
      providerProjectId: binding.providerProjectId,
      providerProjectSlug: binding.providerProjectSlug,
    },
    kind: input.kind,
    path: providerPath,
    key: input.key,
    plaintext: input.plaintext,
  });

  const existing = await db.query.secretReference.findFirst({
    where: and(
      eq(secretReference.organizationId, input.organizationId),
      eq(secretReference.kind, input.kind),
      eq(secretReference.logicalScope, input.logicalScope),
      eq(secretReference.logicalScopeId, input.logicalScopeId),
      eq(secretReference.key, input.key),
    ),
  });

  const now = new Date();

  if (existing) {
    await db
      .update(secretReference)
      .set({
        provider: binding.provider,
        providerPath: providerResult.providerPath,
        providerKey: providerResult.providerKey,
        providerVersion: providerResult.providerVersion,
        updatedAt: now,
      })
      .where(eq(secretReference.id, existing.id));

    const refreshed = await db.query.secretReference.findFirst({
      where: eq(secretReference.id, existing.id),
    });
    if (!refreshed) {
      throw new Error("Secret reference disappeared during update");
    }

    return {
      reference: refreshed,
      providerVersion: refreshed.providerVersion,
      providerPath: refreshed.providerPath,
      providerKey: refreshed.providerKey,
    };
  }

  const row = {
    id: createSecretId(),
    organizationId: input.organizationId,
    provider: binding.provider,
    kind: input.kind,
    logicalScope: input.logicalScope,
    logicalScopeId: input.logicalScopeId,
    key: input.key,
    providerPath: providerResult.providerPath,
    providerKey: providerResult.providerKey,
    providerVersion: providerResult.providerVersion,
    lastResolvedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(secretReference).values(row);

  return {
    reference: row,
    providerVersion: row.providerVersion,
    providerPath: row.providerPath,
    providerKey: row.providerKey,
  };
}

type RevealByReferenceInput = {
  organizationId: string;
  secretReferenceId: string;
  expectedKind?: SecretKind;
};

export async function revealSecretByReference(input: RevealByReferenceInput) {
  const reference = await db.query.secretReference.findFirst({
    where: and(
      eq(secretReference.id, input.secretReferenceId),
      eq(secretReference.organizationId, input.organizationId),
    ),
  });

  if (!reference) {
    throw new Error("Secret reference not found");
  }

  if (input.expectedKind && reference.kind !== input.expectedKind) {
    throw new Error(`Secret kind mismatch: expected ${input.expectedKind}`);
  }

  return revealSecretReferenceRow(reference);
}

export async function revealSecretReferenceRow(
  reference: typeof secretReference.$inferSelect,
) {
  const binding = await ensureOrganizationSecretBinding(reference.organizationId);
  const providerClient = getProviderClient(binding.provider);

  const result = await providerClient.revealSecret({
    binding: {
      organizationId: reference.organizationId,
      providerProjectId: binding.providerProjectId,
      providerProjectSlug: binding.providerProjectSlug,
    } as BindingRef,
    kind: reference.kind,
    path: reference.providerPath,
    key: reference.providerKey,
    version: reference.providerVersion,
  });

  await db
    .update(secretReference)
    .set({
      providerVersion: result.providerVersion ?? reference.providerVersion,
      lastResolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(secretReference.id, reference.id));

  return {
    value: result.value,
    providerVersion: result.providerVersion ?? reference.providerVersion,
  };
}
