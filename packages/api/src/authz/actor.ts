import { auth } from "@otterdeploy/auth";
import { isJsonObject } from "@otterdeploy/shared/json";
import { Result, TaggedError } from "better-result";
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

/**
 * A valid API key that has spent its request budget. Kept apart
 * from "no actor" so the transports answer 429 with a retry hint instead of a
 * 401 that tells automation its credential is wrong.
 */
export class ApiKeyRateLimitedError extends TaggedError("ApiKeyRateLimitedError")<{
  message: string;
  retryAfterSeconds: number;
}>() {
  constructor(retryAfterSeconds: number) {
    super({
      message: `API key rate limit exceeded. Try again in ${retryAfterSeconds}s.`,
      retryAfterSeconds,
    });
  }
}

/** The plugin's rate-limit denial as `verifyApiKey` reports it (the APIError
 *  body is spread into `error`, so `details` is there at runtime but untyped). */
const rateLimitedVerifyError = z.object({
  code: z.literal("RATE_LIMITED"),
  details: z.object({ tryAgainIn: z.number() }).optional(),
});

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
 * over API keys, matching Better Auth's existing request behavior. Errs only
 * for a real API key that is over its rate limit; every other failure is an
 * anonymous (`null`) actor.
 */
export async function resolveRequestActor(
  headers: Headers,
  options: { bearerOverride?: string } = {},
): Promise<Result<ResolvedActor, ApiKeyRateLimitedError>> {
  const sessionResult = await Result.tryPromise({
    try: () => auth.api.getSession({ headers }),
    catch: (cause) => cause,
  });
  const session = sessionResult.isOk() ? sessionResult.value : null;

  if (session?.user) {
    return Result.ok({
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
    });
  }

  const credential = readApiKeyCredential(headers, options.bearerOverride);
  if (!credential) return Result.ok(null);

  const verified = await Result.tryPromise({
    try: () => auth.api.verifyApiKey({ body: { key: credential } }),
    catch: (cause) => cause,
  });
  if (verified.isErr()) return Result.ok(null);
  const rateLimited = rateLimitedVerifyError.safeParse(verified.value.error);
  if (rateLimited.success) {
    const tryAgainInMs = rateLimited.data.details?.tryAgainIn ?? 0;
    return Result.err(new ApiKeyRateLimitedError(Math.max(1, Math.ceil(tryAgainInMs / 1000))));
  }
  if (!verified.value.valid || !verified.value.key) return Result.ok(null);

  const apiKey = verified.value.key;
  const permissions = permissionRecordSchema.safeParse(apiKey.permissions);
  return Result.ok({
    kind: "api-key",
    id: apiKey.id,
    permissions: permissions.success ? permissions.data : null,
    organizationId: apiKey.referenceId ?? null,
    ...parseMetadata(apiKey.metadata),
  });
}
