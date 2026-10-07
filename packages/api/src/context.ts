import type { OrganizationId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";
import type { EvlogVariables } from "evlog/hono";
import type { Context as HonoContext } from "hono";

import { ID_PREFIX, zId } from "@otterdeploy/shared/id";

import type { AuditDraft } from "./audit/changes";
import type {
  ApiKeyActor,
  ApiKeyRateLimitedError,
  ResolvedActor,
  SessionActor,
} from "./authz/actor";

import { resolveRequestActor } from "./authz/actor";

export type { ApiKeyActor, ResolvedActor, SessionActor } from "./authz/actor";

type OrgId = OrganizationId;

const organizationIdSchema = zId(ID_PREFIX.organization);

export interface CreateContextOptions {
  // The evlog Variables pin `context.get("log")` to the per-request logger
  // the evlog Hono middleware attaches.
  context: HonoContext<EvlogVariables>;
  broadcast: (resource: string) => void;
}

export interface RequestContext {
  actor: ResolvedActor;
  session: SessionActor | null;
  apiKey: ApiKeyActor | null;
  /** Set when the request carried a real API key that is over its rate limit;
   *  `actor` is null then, and the auth middlewares answer 429, not 401.
   *  Optional so contexts built by hand (tests, internal callers) need not
   *  spell out the "not rate limited" case. */
  apiKeyRateLimited?: ApiKeyRateLimitedError | null;
  activeOrganizationId: OrgId | null;
  headers: Headers;
  log: RequestLogger;
  broadcast: (resource: string) => void;
  /**
   * Slot for a handler's before/after diff, injected per procedure invocation
   * by `traceProcedure`, not by `createContext`, so it is never shared between
   * two calls. Declared optional here so handler code compiles without
   * depending on middleware type inference. See audit/changes.ts.
   */
  auditDraft?: AuditDraft;
}

export async function createContext({
  context,
  broadcast,
}: CreateContextOptions): Promise<RequestContext> {
  const headers = context.req.raw.headers;
  const resolved = await resolveRequestActor(headers);
  const actor = resolved.isOk() ? resolved.value : null;
  const apiKeyRateLimited = resolved.isErr() ? resolved.error : null;
  const session = actor?.kind === "session" ? actor : null;
  const apiKey = actor?.kind === "api-key" ? actor : null;

  // The evlog Hono middleware (app.use(evlog())) attaches a per-request
  // wide-event logger. Handlers accumulate context via context.log.set(...).
  const log: RequestLogger = context.get("log");

  // Active org: the session's for cookie/bearer actors, else the key's owning
  // org so org-scoped procedures resolve a tenant for an API-key actor. The
  // actor types carry plain strings; parse to the branded id at this boundary
  // (also canonicalizing any legacy "organization_" spelling).
  const rawOrganizationId = session?.session.activeOrganizationId ?? apiKey?.organizationId ?? null;
  const parsedOrganizationId =
    rawOrganizationId === null ? null : organizationIdSchema.safeParse(rawOrganizationId);
  const activeOrganizationId: OrgId | null =
    parsedOrganizationId?.success === true ? parsedOrganizationId.data : null;

  return {
    actor,
    session,
    apiKey,
    apiKeyRateLimited,
    activeOrganizationId,
    // Raw request headers, carried so org-scoped middleware can delegate
    // role/permission checks to better-auth's `auth.api.hasPermission`
    // (which resolves the active member from the session cookie/bearer).
    headers,
    log,
    broadcast,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
