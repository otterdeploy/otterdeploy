import type { OrganizationId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";
import type { Context as HonoContext } from "hono";

import { auth } from "@otterdeploy/auth";
import { Result } from "better-result";
type OrgId = OrganizationId;

/** Our minted-key prefix (packages/auth/src/index.ts → `defaultPrefix`). Only
 *  credentials carrying it are treated as otterdeploy API keys; the CLI's
 *  device-grant bearer (a different shape) falls through to session auth. */
const API_KEY_PREFIX = "otter_";

/**
 * The authenticated API-key actor for a request, or null for session/cookie
 * (and CLI device-grant) requests. `permissions` is the deserialized
 * `{resource: actions[]}` map the key was minted with (null = full-access);
 * `referenceId` is the owning org id (`references: "organization"`). The
 * accessLevel / projectScope / projectIds presets ride in the key's metadata.
 */
export interface ApiKeyActor {
  id: string;
  permissions: Record<string, string[]> | null;
  referenceId: string | null;
  accessLevel?: "read" | "write";
  projectScope?: "all" | "selected";
  projectIds?: string[];
}

/**
 * Pull an `otter_`-prefixed credential off the request. Mirrors the apiKey
 * plugin's own resolution order: `Authorization: Bearer <token>` first, then
 * the `x-api-key` header. Returns null for anything that isn't one of ours so
 * cookie sessions and the CLI device-grant bearer are untouched.
 */
function readApiKeyCredential(headers: Headers): string | null {
  const authz = headers.get("authorization");
  const bearer = authz?.startsWith("Bearer ") ? authz.slice(7).trim() : null;
  if (bearer?.startsWith(API_KEY_PREFIX)) return bearer;

  const xApiKey = headers.get("x-api-key");
  if (xApiKey?.startsWith(API_KEY_PREFIX)) return xApiKey;

  return null;
}

/**
 * Verify an otterdeploy API key and shape it into an ApiKeyActor. We verify
 * WITHOUT a `permissions` argument — `auth.api.verifyApiKey` throws on a
 * null-permission (full-access) key when permissions are passed — then intersect
 * the key's scope ourselves downstream (see authz/api-key-scope.ts). Any
 * verify failure (invalid/disabled/expired/throw) yields null so the request
 * simply falls through unauthenticated.
 */
async function verifyApiKeyActor(key: string): Promise<ApiKeyActor | null> {
  const verified = await Result.tryPromise({
    try: () => auth.api.verifyApiKey({ body: { key } }),
    catch: (cause) => cause,
  });
  if (verified.isErr()) return null;

  const { valid, key: apiKey } = verified.value;
  if (!valid || !apiKey) return null;

  const metadata = (apiKey.metadata ?? {}) as {
    accessLevel?: "read" | "write";
    projectScope?: "all" | "selected";
    projectIds?: string[];
  };

  return {
    id: apiKey.id,
    permissions: (apiKey.permissions ?? null) as Record<string, string[]> | null,
    referenceId: apiKey.referenceId ?? null,
    accessLevel: metadata.accessLevel,
    projectScope: metadata.projectScope,
    projectIds: metadata.projectIds,
  };
}

export interface CreateContextOptions {
  context: HonoContext;
  broadcast: (resource: string) => void;
}

export async function createContext({ context, broadcast }: CreateContextOptions) {
  const headers = context.req.raw.headers;

  const session = await auth.api.getSession({
    headers,
  });

  // Org-scoped API keys never resolve via getSession (the apiKey plugin's
  // session hook is default-off and rejects references !== "user"), so detect
  // an `otter_` credential ourselves and verify it directly. Only attempted
  // when there's no cookie session — session/cookie + CLI device-grant bearer
  // keep the exact existing code path.
  const apiKeyCredential = session ? null : readApiKeyCredential(headers);
  const apiKey = apiKeyCredential ? await verifyApiKeyActor(apiKeyCredential) : null;

  // The evlog Hono middleware (app.use(evlog())) attaches a per-request
  // wide-event logger. Handlers accumulate context via context.log.set(...).
  const log = context.get("log") as RequestLogger;

  return {
    session,
    apiKey,
    // Active org: the session's for cookie/bearer actors, else the key's owning
    // org so org-scoped procedures resolve a tenant for an API-key actor.
    activeOrganizationId: (session?.session.activeOrganizationId ??
      apiKey?.referenceId ??
      null) as OrgId | null,
    // Raw request headers — carried so org-scoped middleware can delegate
    // role/permission checks to better-auth's `auth.api.hasPermission`
    // (which resolves the active member from the session cookie/bearer).
    headers,
    log,
    broadcast,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
