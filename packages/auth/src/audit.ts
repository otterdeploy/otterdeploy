import type { AuthMiddleware } from "better-auth/api";
import type { BetterAuthOptions, Session, User } from "better-auth/types";

/**
 * Writes the auth audit trail.
 *
 * The oRPC middleware in `packages/api/src/index.ts` audits every mutating
 * procedure and every denial, but better-auth serves its own routes under
 * `/api/auth/*` and never emits an evlog audit envelope. Everything on the
 * identity surface was therefore missing from `audit_log`: no sign-in history,
 * no record of a failed password, no trace of who invited, removed or re-roled
 * a member, and nothing when an API key: a credential that can drive the whole
 * control plane: was minted. Those are the first questions anyone asks of an
 * audit trail, so the gap mattered more than the row count suggested.
 *
 * Rows are written straight to `audit_log`, the same way (and for the same
 * reason as) `packages/api/src/audit/system.ts` and `audit/terminal.ts`: these
 * requests never carry an audit envelope for the pg drain to pick up.
 *
 * What is audited and how it is classified lives in ./audit-policy.ts.
 */
import { db } from "@otterdeploy/db";
import { auditLog } from "@otterdeploy/db/schema";
import { user as userTbl } from "@otterdeploy/db/schema/auth";
import { createAuthMiddleware, getIp } from "better-auth/api";
import { eq, sql } from "drizzle-orm";
import { log } from "evlog";

import type { AuditedPath } from "./audit-policy";

import {
  auditEntryForPath,
  classifyAuthOutcome,
  clip,
  detailFrom,
  MAX_EMAIL,
  MAX_ID,
} from "./audit-policy";

/**
 * The session/user pair better-auth attaches to a hook context. `Session` and
 * `User` are the library's own row types; the organization plugin stamps
 * `activeOrganizationId` onto the session row, which the base type omits.
 */
interface AuthHookIdentity {
  session: Session & { activeOrganizationId?: string | null };
  user: User;
}

interface AuthHookContext {
  path: string;
  body?: unknown;
  request?: Request;
  headers?: Headers;
  context: {
    returned?: unknown;
    newSession?: AuthHookIdentity | null;
    session?: AuthHookIdentity | null;
    options: BetterAuthOptions;
  };
}

type ResolveOrganizationId = (userId: string) => Promise<string | null>;

interface AuthActor {
  actorId: string;
  actorEmail: string | null;
  actorLabel: string | null;
  userId: string | null;
  sessionOrgId: string | null;
}

/**
 * Build the `hooks.after` middleware.
 *
 * `resolveOrganizationId` is injected rather than imported so this module does
 * not have to reach back into `index.ts` (which imports this one), and so a
 * test can drive the hook without a membership table.
 */
export function createAuthAuditHook({
  resolveOrganizationId,
}: {
  resolveOrganizationId: ResolveOrganizationId;
  // Return type annotated rather than inferred so this hook contributes a
  // nameable type to the exported `auth` object's shape.
}): AuthMiddleware {
  return createAuthMiddleware(async (rawCtx) => {
    // Re-shaped field by field rather than asserted: every property below is
    // checked against AuthHookContext by the annotation, so a better-auth
    // upgrade that changes the hook context shape fails here at compile time.
    const ctx: AuthHookContext = {
      path: rawCtx.path,
      body: rawCtx.body,
      request: rawCtx.request,
      headers: rawCtx.headers,
      context: {
        returned: rawCtx.context.returned,
        newSession: rawCtx.context.newSession,
        session: rawCtx.context.session,
        options: rawCtx.context.options,
      },
    };
    try {
      await recordAuthEvent(ctx, resolveOrganizationId);
    } catch (cause) {
      // The sign-in already succeeded or failed on its own merits by the time
      // this runs. Losing the row is bad; losing the login is worse.
      log.warn({
        authAudit: { event: "write-failed", path: ctx.path },
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  });
}

async function recordAuthEvent(
  ctx: AuthHookContext,
  resolveOrganizationId: ResolveOrganizationId,
): Promise<void> {
  const entry = auditEntryForPath(ctx.path);
  if (!entry) return;

  const { outcome, reason } = classifyAuthOutcome(ctx.context.returned);
  if (entry.successOnly && outcome !== "success") return;

  const actor = resolveActor(ctx);
  const organizationId = await resolveTenant(actor, resolveOrganizationId);
  const target = buildTarget(entry, actor.userId, detailFrom(ctx.body, entry.detailFields));

  await db.insert(auditLog).values({
    organizationId,
    action: entry.action,
    // "user" even for an unauthenticated attempt: a person is acting, and the
    // enum has no better slot. `actorId === "anonymous"` is the signal that
    // identity was never established.
    actorType: "user",
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorLabel: actor.actorLabel,
    ...target,
    outcome,
    reason: reason ?? null,
    ip: resolveIp(ctx),
    userAgent: clip(readHeader(ctx, "user-agent"), 512),
  });
}

/**
 * Who acted.
 *
 * `newSession` is the session this request is about to set a cookie for.
 * Present exactly on the requests that just established identity (sign-in,
 * sign-up, 2FA verification). Everything else reads the existing session.
 *
 * A failed sign-in has no session at all, so the submitted address is the only
 * identity available. Recording it is the whole point of the row: "someone
 * tried to get into this account", and `actorId` falls back to a sentinel
 * because the column is NOT NULL and no user was ever established.
 */
function resolveActor(ctx: AuthHookContext): AuthActor {
  const identity = ctx.context.newSession ?? ctx.context.session ?? null;
  const user = identity?.user;
  const userId = clip(user?.id, MAX_ID);
  return {
    actorId: userId ?? "anonymous",
    actorEmail: clip(user?.email, MAX_EMAIL) ?? readEmail(ctx.body),
    actorLabel: clip(user?.name, MAX_ID),
    userId,
    sessionOrgId: clip(identity?.session?.activeOrganizationId, MAX_ID),
  };
}

/**
 * Which tenant the row belongs to.
 *
 * Resolved from server-side state only, never from `body.organizationId`,
 * which a caller controls and which would either misattribute the row or fail
 * the insert outright against the FK.
 *
 * For a failed sign-in there is no session to read it from, so the *target*
 * account's org is used: that is what makes a brute-force burst visible to the
 * org being attacked, since the denial-burst rule in
 * packages/api/src/notifications/audit-anomaly.ts skips null-tenant rows. An
 * attempt against an address with no account stays null, genuinely
 * un-attributable, and not worth inventing a tenant for.
 */
async function resolveTenant(
  actor: AuthActor,
  resolveOrganizationId: ResolveOrganizationId,
): Promise<string | null> {
  if (actor.sessionOrgId) return actor.sessionOrgId;
  if (actor.userId) return resolveOrganizationId(actor.userId);
  if (actor.actorEmail) return resolveOrganizationForEmail(actor.actorEmail, resolveOrganizationId);
  return null;
}

/** What was acted on. Omitted entirely when nothing identifies a target. */
function buildTarget(
  entry: AuditedPath,
  userId: string | null,
  detail: Record<string, string>,
): { targetType: string | null; targetId: string | null; target: Record<string, string> | null } {
  const targetId = userId ?? Object.values(detail)[0] ?? null;
  if (!entry.targetType || (!targetId && Object.keys(detail).length === 0)) {
    return { targetType: null, targetId: null, target: null };
  }
  return {
    targetType: entry.targetType,
    targetId,
    target: { ...detail, type: entry.targetType },
  };
}

/** The submitted address on an attempt that never reached a session. */
function readEmail(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("email" in body)) return null;
  return clip(body.email, MAX_EMAIL);
}

/** Attribute a failed attempt to the targeted account's org, when it exists. */
async function resolveOrganizationForEmail(
  email: string,
  resolveOrganizationId: ResolveOrganizationId,
): Promise<string | null> {
  const [found] = await db
    .select({ id: userTbl.id })
    .from(userTbl)
    .where(eq(sql`lower(${userTbl.email})`, email.toLowerCase()))
    .limit(1);
  return found?.id ? resolveOrganizationId(found.id) : null;
}

function readHeader(ctx: AuthHookContext, name: string): string | null {
  return ctx.request?.headers.get(name) ?? ctx.headers?.get(name) ?? null;
}

/**
 * The caller's IP, via better-auth's configured `ipAddressHeaders` (pointed at
 * `x-forwarded-for`).
 *
 * Trustworthy only because `sanitizeForwardingHeaders`: the first middleware
 * in apps/server/src/index.ts: has already deleted that header unless the
 * immediate TCP peer is in TRUSTED_PROXIES. A direct caller therefore records
 * no IP rather than one it chose. See packages/api/src/security/trusted-proxy.ts.
 */
function resolveIp(ctx: AuthHookContext): string | null {
  const source = ctx.request ?? ctx.headers;
  if (!source) return null;
  return getIp(source, ctx.context.options);
}
