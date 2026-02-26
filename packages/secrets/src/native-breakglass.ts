import { createHash, randomUUID } from "node:crypto";

import { createDockerSecret } from "@otterdeploy/docker";
import { env } from "@otterdeploy/env/server";
import { createLogger } from "@otterdeploy/logger";

import { decrypt, encrypt } from "./encryption";
import type {
  BindingRef,
  ProviderEnsureBindingResult,
  ProviderRevealResult,
  ProviderUpsertResult,
  SecretProviderClient,
} from "./provider";
import type { SecretKind } from "./types";

const log = createLogger("secrets:native-breakglass");
const ENCRYPTED_VERSION_PREFIX = "enc:v1:";

function deriveEncryptionKeyHex(): string {
  return createHash("sha256").update(env.BETTER_AUTH_SECRET).digest("hex");
}

function encodeProviderVersion(plaintext: string): string {
  const encrypted = encrypt(plaintext, deriveEncryptionKeyHex());
  return `${ENCRYPTED_VERSION_PREFIX}${encrypted}`;
}

function decodeProviderVersion(version: string): string {
  if (!version.startsWith(ENCRYPTED_VERSION_PREFIX)) {
    return version;
  }
  const payload = version.slice(ENCRYPTED_VERSION_PREFIX.length);
  return decrypt(payload, deriveEncryptionKeyHex());
}

function sanitizeNamePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 32);
}

function hashPathKey(path: string, key: string): string {
  return createHash("sha256").update(`${path}::${key}`).digest("hex").slice(0, 12);
}

function buildSecretName(input: {
  organizationId: string;
  kind: SecretKind;
  path: string;
  key: string;
  suffix?: string;
}) {
  const org = sanitizeNamePart(input.organizationId).slice(0, 10);
  const kind = sanitizeNamePart(input.kind).slice(0, 12);
  const keyHash = hashPathKey(input.path, input.key);
  const suffix = input.suffix ?? Date.now().toString(36);
  return `otterstack-${org}-${kind}-${keyHash}-${suffix}`;
}

export class NativeBreakglassProvider implements SecretProviderClient {
  readonly name = "native_breakglass" as const;

  async ensureOrganizationBinding(
    organizationId: string,
  ): Promise<ProviderEnsureBindingResult> {
    const projectSlug = sanitizeNamePart(`swarm-${organizationId}`);
    return {
      providerProjectId: `swarm:${organizationId}`,
      providerProjectSlug: projectSlug,
    };
  }

  async upsertSecret(input: {
    binding: BindingRef;
    kind: SecretKind;
    path: string;
    key: string;
    plaintext: string;
  }): Promise<ProviderUpsertResult> {
    const baseName = buildSecretName({
      organizationId: input.binding.organizationId,
      kind: input.kind,
      path: input.path,
      key: input.key,
    });

    let secretName = baseName;
    let createResult = await createDockerSecret(secretName, input.plaintext, {
      "otterstack.organization.id": input.binding.organizationId,
      "otterstack.secret.kind": input.kind,
      "otterstack.secret.path": input.path,
      "otterstack.secret.key": input.key,
    });

    if (createResult.isErr()) {
      secretName = buildSecretName({
        organizationId: input.binding.organizationId,
        kind: input.kind,
        path: input.path,
        key: input.key,
        suffix: randomUUID().slice(0, 8),
      });
      createResult = await createDockerSecret(secretName, input.plaintext, {
        "otterstack.organization.id": input.binding.organizationId,
        "otterstack.secret.kind": input.kind,
        "otterstack.secret.path": input.path,
        "otterstack.secret.key": input.key,
      });
    }

    if (createResult.isErr()) {
      throw createResult.error;
    }

    log.info(
      {
        organizationId: input.binding.organizationId,
        kind: input.kind,
        secretName,
      },
      "Docker Swarm secret stored",
    );

    return {
      providerPath: input.path,
      providerKey: secretName,
      providerVersion: encodeProviderVersion(input.plaintext),
    };
  }

  async revealSecret(input: {
    binding: BindingRef;
    kind: SecretKind;
    path: string;
    key: string;
    version: string | null;
  }): Promise<ProviderRevealResult> {
    if (!input.version) {
      throw new Error("Missing native_breakglass provider version payload");
    }

    return {
      value: decodeProviderVersion(input.version),
      providerVersion: input.version,
    };
  }
}
