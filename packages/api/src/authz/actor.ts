import { auth } from "@otterdeploy/auth";
import { isJsonObject } from "@otterdeploy/shared/json";
import { Result } from "better-result";
import * as z from "zod";

/** Shape of the permissions blob better-auth stores on an API key. */
const permissionRecordSchema = z.record(z.string(), z.array(z.string()));

/** Credentials minted by the Better Auth API-key plugin for OtterDeploy. */
const API_KEY_PREFIX = "otter_";

export interface ApiKeyActor {
  kind: "api-key";
  id: string;
  permissions: Record<string, string[]> | null;
  organizationId: string | null;
  accessLevel?: "read" | "write";
  projectScope?: "all" | "selected";
  projectIds?: string[];
}

export interface SessionActor {
  kind: "session";
  /** Original request headers used by Better Auth for live session/RBAC checks. */
  headers: Headers;
  user: {
    id: string;
    email: string;
    isInstallAdmin: boolean;
    twoFactorEnabled: boolean;
  };
  session: {
    activeOrganizationId?: string | null;
  };
}

export type ResolvedActor = SessionActor | ApiKeyActor | null;

function readApiKeyCredential(headers: Headers, bearerOverride?: string): string | null {
  const authorization = headers.get("authorization");
  const bearer = bearerOverride ?? authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer?.startsWith(API_KEY_PREFIX)) return bearer;

  const apiKey = headers.get("x-api-key")?.trim();
  return apiKey?.startsWith(API_KEY_PREFIX) ? apiKey : null;
}

function parseMetadata(
  metadata: unknown,
): Pick<ApiKeyActor, "accessLevel" | "projectIds" | "projectScope"> {
  // API-key metadata is stored as JSON by Better Auth, so the JSON-object
  // narrowing is sound here.
  if (!isJsonObject(metadata)) return {};

  return {
    accessLevel:
      metadata.accessLevel === "read" || metadata.accessLevel === "write"
        ? metadata.accessLevel
        : undefined,
    projectScope:
      metadata.projectScope === "all" || metadata.projectScope === "selected"
        ? metadata.projectScope
        : undefined,
    projectIds: Array.isArray(metadata.projectIds)
      ? metadata.projectIds.filter(
          (projectId): projectId is string => typeof projectId === "string",
        )
      : undefined,
  };
}

/**
 * Resolve one normalized request actor. Cookie/device sessions take precedence
 * over API keys, matching Better Auth's existing request behavior.
 */
export async function resolveRequestActor(
  headers: Headers,
  options: { bearerOverride?: string } = {},
): Promise<ResolvedActor> {
  const sessionResult = await Result.tryPromise({
    try: () => auth.api.getSession({ headers }),
    catch: (cause) => cause,
  });
  const session = sessionResult.isOk() ? sessionResult.value : null;

  if (session?.user) {
    return {
      kind: "session",
      headers,
      user: {
        id: session.user.id,
        email: session.user.email,
        isInstallAdmin: session.user.isInstallAdmin === true,
        twoFactorEnabled: session.user.twoFactorEnabled === true,
      },
      session: {
        activeOrganizationId: session.session.activeOrganizationId,
      },
    };
  }

  const credential = readApiKeyCredential(headers, options.bearerOverride);
  if (!credential) return null;

  const verified = await Result.tryPromise({
    try: () => auth.api.verifyApiKey({ body: { key: credential } }),
    catch: (cause) => cause,
  });
  if (verified.isErr() || !verified.value.valid || !verified.value.key) return null;

  const apiKey = verified.value.key;
  const permissions = permissionRecordSchema.safeParse(apiKey.permissions);
  return {
    kind: "api-key",
    id: apiKey.id,
    permissions: permissions.success ? permissions.data : null,
    organizationId: apiKey.referenceId ?? null,
    ...parseMetadata(apiKey.metadata),
  };
}
