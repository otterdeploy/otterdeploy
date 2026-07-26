import type { OrganizationId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";
import type { Context as HonoContext } from "hono";

import type { AuditDraft } from "./audit/changes";
import type { ApiKeyActor, ResolvedActor, SessionActor } from "./authz/actor";

import { resolveRequestActor } from "./authz/actor";

export type { ApiKeyActor, ResolvedActor, SessionActor } from "./authz/actor";

type OrgId = OrganizationId;

export interface CreateContextOptions {
  context: HonoContext;
  broadcast: (resource: string) => void;
}

export interface RequestContext {
  actor: ResolvedActor;
  session: SessionActor | null;
  apiKey: ApiKeyActor | null;
  activeOrganizationId: OrgId | null;
  headers: Headers;
  log: RequestLogger;
  broadcast: (resource: string) => void;
  /**
   * Slot for a handler's before/after diff, injected per procedure invocation
   * by `traceProcedure` — not by `createContext`, so it is never shared between
   * two calls. Declared optional here so handler code compiles without
   * depending on middleware type inference. See audit/changes.ts.
   */
  auditDraft?: AuditDraft;
  /**
   * This call's correlation id (od-5j8.21) — injected by `traceProcedure`,
   * not `createContext`, same reasoning as `auditDraft` above. Threads a
   * single logical user action across the audit trail: every audit row
   * `traceProcedure` writes for this call carries it, and a handler that
   * kicks off async follow-on work (a BullMQ job, a system audit row
   * written later by a different process) should forward it so that work's
   * own audit rows can be tied back to the request that caused them — see
   * `routers/project/manifest-apply-git.ts` → `packages/jobs`
   * `DeployTriggeredPayload.correlationId` → `apps/builder/src/handler.ts`
   * for the concrete example.
   */
  correlationId?: string;
}

export async function createContext({
  context,
  broadcast,
}: CreateContextOptions): Promise<RequestContext> {
  const headers = context.req.raw.headers;
  const actor = await resolveRequestActor(headers);
  const session = actor?.kind === "session" ? actor : null;
  const apiKey = actor?.kind === "api-key" ? actor : null;

  // The evlog Hono middleware (app.use(evlog())) attaches a per-request
  // wide-event logger. Handlers accumulate context via context.log.set(...).
  const log = context.get("log") as RequestLogger;

  return {
    actor,
    session,
    apiKey,
    // Active org: the session's for cookie/bearer actors, else the key's owning
    // org so org-scoped procedures resolve a tenant for an API-key actor.
    activeOrganizationId: (session?.session.activeOrganizationId ??
      apiKey?.organizationId ??
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
