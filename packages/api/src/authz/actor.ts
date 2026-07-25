import { auth } from "@otterdeploy/auth";
import { Result } from "better-result";

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
  if (!metadata || typeof metadata !== "object") return {};
  const value = metadata as Record<string, unknown>;

  return {
    accessLevel:
      value.accessLevel === "read" || value.accessLevel === "write" ? value.accessLevel : undefined,
    projectScope:
      value.projectScope === "all" || value.projectScope === "selected"
        ? value.projectScope
        : undefined,
    projectIds: Array.isArray(value.projectIds)
      ? value.projectIds.filter((projectId): projectId is string => typeof projectId === "string")
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
  return {
    kind: "api-key",
    id: apiKey.id,
    permissions: (apiKey.permissions ?? null) as Record<string, string[]> | null,
    organizationId: apiKey.referenceId ?? null,
    ...parseMetadata(apiKey.metadata),
  };
}
