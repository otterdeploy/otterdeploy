import type { OrganizationId } from "@otterdeploy/shared/id";
import type { Context } from "hono";

import { listTerminalTargets } from "@otterdeploy/api/routers/terminal/handlers";
import { auth } from "@otterdeploy/auth";
import { Result, TaggedError } from "better-result";

import type { Target } from "./pty";

// ---------------------------------------------------------------------------
// /pty upgrade auth. Credential sources, in order:
//   1. Request cookies / Authorization header — browsers send cookies on the
//      WS upgrade, so the web UI works unchanged.
//   2. `?token=` query param for non-browser clients (Bun's WebSocket cannot
//      set headers): `otter_`-prefixed values verify as org API keys, anything
//      else is treated as a bearer session token.
// Authorization: containers must be org-owned (same discovery source the
// terminal picker uses); host shells are platform-admin surface and require a
// real user session — never an API key.
// ---------------------------------------------------------------------------

/** Same minted-key prefix as packages/api/src/context.ts. */
const API_KEY_PREFIX = "otter_";

export class PtyAuthError extends TaggedError("PtyAuthError")<{
  status: 401 | 403;
  message: string;
}>() {}

export interface PtyActor {
  userId: string | null;
  organizationId: OrganizationId;
}

interface ResolvedActor {
  userId: string | null;
  organizationId: OrganizationId | null;
  isApiKey: boolean;
  // Effective auth headers — what session-bound better-auth checks
  // (hasPermission) resolve against. Empty for API-key actors, which never
  // reach a session-bound check (host shells reject them first).
  headers: Headers;
}

async function resolveSession(headers: Headers): Promise<ResolvedActor | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  return {
    userId: session.user.id,
    organizationId: (session.session.activeOrganizationId ?? null) as OrganizationId | null,
    isApiKey: false,
    headers,
  };
}

/**
 * Verify WITHOUT a `permissions` argument — mirrors packages/api/src/context.ts
 * (`verifyApiKey` throws on a null-permission full-access key when permissions
 * are passed). Any verify failure yields null → the upgrade is rejected as
 * unauthenticated.
 */
async function resolveApiKey(key: string): Promise<ResolvedActor | null> {
  const verified = await Result.tryPromise({
    try: () => auth.api.verifyApiKey({ body: { key } }),
    catch: (cause) => cause,
  });
  if (verified.isErr()) return null;

  const { valid, key: apiKey } = verified.value;
  if (!valid || !apiKey) return null;

  return {
    // Org-referenced keys carry no owning user, so OTTERDEPLOY_USER stays unset.
    userId: null,
    organizationId: (apiKey.referenceId ?? null) as OrganizationId | null,
    isApiKey: true,
    headers: new Headers(),
  };
}

async function resolveActor(c: Context): Promise<ResolvedActor | null> {
  const fromRequest = await resolveSession(c.req.raw.headers);
  if (fromRequest) return fromRequest;

  const token = c.req.query("token");
  if (!token) return null;
  if (token.startsWith(API_KEY_PREFIX)) return resolveApiKey(token);
  return resolveSession(new Headers({ authorization: `Bearer ${token}` }));
}

/**
 * Authenticate + authorize a /pty upgrade request. Runs BEFORE the WebSocket
 * upgrade, so a denial is a plain HTTP 401/403 — the socket never opens and no
 * backend is spawned. A null target passes through: the post-upgrade
 * MISSING_TARGET control frame keeps its existing wire behavior.
 */
export async function authorizePty(
  c: Context,
  target: Target | null,
): Promise<Result<PtyActor, PtyAuthError>> {
  const actor = await resolveActor(c);
  if (!actor) {
    return Result.err(new PtyAuthError({ status: 401, message: "Authentication required" }));
  }
  const organizationId = actor.organizationId;
  if (!organizationId) {
    return Result.err(new PtyAuthError({ status: 403, message: "No active organization" }));
  }

  if (target?.kind === "container") {
    // Same org-scoped discovery the terminal picker uses — the container must
    // be one this org could have selected, never a raw daemon-wide docker id.
    const targets = await listTerminalTargets({ organizationId });
    const owned = targets.containers.some((ct) => ct.containerId === target.id);
    if (!owned) {
      return Result.err(
        new PtyAuthError({ status: 403, message: "Container not found in this organization" }),
      );
    }
  }

  if (target?.kind === "host") {
    if (actor.isApiKey) {
      return Result.err(
        new PtyAuthError({ status: 403, message: "Host shell requires a user session" }),
      );
    }
    const permitted = await Result.tryPromise({
      try: () =>
        auth.api.hasPermission({
          headers: actor.headers,
          body: { permissions: { platform: ["update"] } },
        }),
      catch: (cause) => cause,
    });
    if (permitted.isErr() || !permitted.value.success) {
      return Result.err(
        new PtyAuthError({ status: 403, message: "Host shell requires platform admin access" }),
      );
    }
  }

  return Result.ok({ userId: actor.userId, organizationId });
}
