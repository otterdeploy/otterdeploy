import { auth } from "@otterdeploy/auth";
import { isJsonObject } from "@otterdeploy/shared/json";
import { Result, TaggedError } from "better-result";
import * as z from "zod";

import { credentialStoreAnswers } from "./credential-store";

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

/**
 * The credential store could not be read: the session lookup or the API-key
 * verification failed for a reason that is not "this credential is no good".
 * Postgres down used to read as "no actor", so a signed-in
 * browser was answered UNAUTHORIZED, which the dashboard treats as signed out.
 * Kept apart so the transports answer 503 and the client retries instead.
 */
export class AuthStoreUnavailableError extends TaggedError("AuthStoreUnavailableError")<{
  message: string;
  cause: unknown;
}>() {
  constructor(cause: unknown) {
    super({ message: "Sign-in could not be checked right now. Try again shortly.", cause });
  }
}

/**
 * Whether a better-auth endpoint's rejection is a verdict on the credential
 * (a 4xx: bad, expired or revoked) rather than a failure to look it up. A
 * lookup that fails (its database is down) surfaces as an APIError with a 5xx
 * status, or as whatever the adapter threw; neither says the caller is
 * anonymous.
 */
const credentialVerdictSchema = z.object({ statusCode: z.number().int().min(400).max(499) });
function isCredentialVerdict(cause: unknown): boolean {
  return credentialVerdictSchema.safeParse(cause).success;
}

/** The plugin's rate-limit denial as `verifyApiKey` reports it (the APIError
 *  body is spread into `error`, so `details` is there at runtime but untyped). */
const rateLimitedVerifyError = z.object({
  code: z.literal("RATE_LIMITED"),
  details: z.object({ tryAgainIn: z.number() }).optional(),
});

/**
 * The key's permission map as authorization reads it. Only an ABSENT map is
 * full access (null: chosen explicitly, or a key minted before the choice
 * existed; see authorizeKeyScope). A map that is present but does not parse
 * grants nothing: a corrupt grant must never widen into a full-access key.
 */
function parseKeyPermissions(stored: unknown): Record<string, string[]> | null {
  if (stored === null || stored === undefined) return null;
  const parsed = permissionRecordSchema.safeParse(stored);
  return parsed.success ? parsed.data : {};
}

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
 * over API keys, matching Better Auth's existing request behavior. Errs for a
 * real API key that is over its rate limit, and when the credential store
 * could not be read at all (AuthStoreUnavailableError: not a verdict on the
 * caller). A credential that is simply not valid is an anonymous (`null`)
 * actor.
 */
export async function resolveRequestActor(
  headers: Headers,
  options: { bearerOverride?: string } = {},
): Promise<Result<ResolvedActor, ApiKeyRateLimitedError | AuthStoreUnavailableError>> {
  const session = await resolveSession(headers);
  if (session.isErr() || session.value) return session;

  const credential = readApiKeyCredential(headers, options.bearerOverride);
  if (!credential) return Result.ok(null);
  return resolveApiKey(credential);
}

/** A lookup that failed is anonymous only if the store can still answer;
 *  otherwise the store is down and nothing was judged. */
async function anonymousUnlessStoreDown(
  cause: unknown,
): Promise<Result<null, AuthStoreUnavailableError>> {
  const probe = await credentialStoreAnswers();
  return probe.isErr() ? Result.err(new AuthStoreUnavailableError(cause)) : Result.ok(null);
}

async function resolveSession(
  headers: Headers,
): Promise<Result<SessionActor | null, AuthStoreUnavailableError>> {
  const sessionResult = await Result.tryPromise({
    try: () => auth.api.getSession({ headers }),
    catch: (cause) => cause,
  });
  // better-auth answers a session it could not READ with a 500, the same as a
  // fault anywhere else in the lookup (a mangled cache cookie included). Only
  // a store that also fails the probe makes it an outage; otherwise the
  // request stays anonymous, as it always was.
  if (sessionResult.isErr()) {
    return isCredentialVerdict(sessionResult.error)
      ? Result.ok(null)
      : anonymousUnlessStoreDown(sessionResult.error);
  }
  const session = sessionResult.value;
  if (!session?.user) return Result.ok(null);
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

async function resolveApiKey(
  credential: string,
): Promise<Result<ApiKeyActor | null, ApiKeyRateLimitedError | AuthStoreUnavailableError>> {
  const verified = await Result.tryPromise({
    try: () => auth.api.verifyApiKey({ body: { key: credential } }),
    catch: (cause) => cause,
  });
  if (verified.isErr()) {
    return isCredentialVerdict(verified.error)
      ? Result.ok(null)
      : anonymousUnlessStoreDown(verified.error);
  }
  const rateLimited = rateLimitedVerifyError.safeParse(verified.value.error);
  if (rateLimited.success) {
    const tryAgainInMs = rateLimited.data.details?.tryAgainIn ?? 0;
    return Result.err(new ApiKeyRateLimitedError(Math.max(1, Math.ceil(tryAgainInMs / 1000))));
  }
  // The plugin reads a key it could not look up as INVALID_API_KEY too.
  const apiKey = verified.value.valid ? verified.value.key : null;
  if (!apiKey) return anonymousUnlessStoreDown(verified.value.error);

  return Result.ok({
    kind: "api-key",
    id: apiKey.id,
    permissions: parseKeyPermissions(apiKey.permissions),
    organizationId: apiKey.referenceId ?? null,
    ...parseMetadata(apiKey.metadata),
  });
}
