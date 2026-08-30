/**
 * Proxy-route orchestration. Surfaces the Caddy proxy routes scoped to a
 * project so the dashboard can render the routing table, plus the
 * deployment-protection control surface: toggle the auth wall, mint
 * shareable links + automation-bypass tokens. See
 * docs/designs/deployment-protection.md.
 */

import type { DeploymentGuestId, ProxyRouteId } from "@otterdeploy/shared/id";
import type { RoutePolicy } from "@otterdeploy/shared/route-policy";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { hasPrefix, ID_PREFIX } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import type { OrgRef, ProjectRef } from "../scopes";

import { type GuestRecord, listGuests, removeGuest, upsertGuest } from "../../authz/guests";
import { signGrantToken } from "../../authz/tokens";
import {
  reconcile,
  renderProjectCaddyfile,
  saveRouteCustomDirectives,
  saveRoutePolicy,
  type ProjectCaddyfile,
  type SaveRoutePolicyResult,
} from "../../caddy";
import { RESERVED_AUTH_PREFIX } from "../../caddy/builder";
import { listProxyRoutesByProject, updateProxyRoute } from "../../caddy/queries";
import { ProjectNotFoundError, ProxyRouteNotFoundError } from "./errors";
import { getProjectInOrg, getRouteInOrg } from "./queries";
import { type ProxyRoute } from "./views";

export { listProjectCertificates, type ProjectCertificates } from "./proxy-route-certs";
export { getRouteAccessPin, setRouteAccessPin } from "./proxy-route-pin";

export async function listProjectProxyRoutes(
  input: ProjectRef,
): Promise<Result<ProxyRoute[], ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  // Base routes only: preview-scoped hosts are lifecycle-managed by the PR
  // webhook and must not surface as project domains.
  const records = (await listProxyRoutesByProject(input.projectId)).filter(
    (r) => r.previewId == null,
  );
  return Result.ok(records);
}

/** Render the project's live Caddyfile fragment for the read-only viewer in
 *  the Networking tab. Auth-scoped to the caller's org via the same project
 *  lookup as the route list. */
export async function getProjectCaddyfile(
  input: ProjectRef,
): Promise<Result<ProjectCaddyfile, ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const rendered = await renderProjectCaddyfile(input.projectId);
  return Result.ok(rendered);
}

export interface GlobalCaddyOptions {
  /** ACME registration email (Let's Encrypt). Null = none configured. */
  acmeEmail: string | null;
  /** Caddy auto HTTP→HTTPS redirect. Defaults on. */
  httpsAutoRedirect: boolean;
  /** CIDRs of the proxies in front of Caddy. Empty ⇒ trust nothing, and
   *  every request is attributed to its TCP peer — which behind a CDN is the
   *  CDN. See packages/api/src/caddy/trusted-proxies.ts. */
  trustedProxies: string;
}

/** Read the instance-wide global Caddy options (the `platform_settings`
 *  singleton). Org-agnostic: there's one edge proxy per install. */
export async function getGlobalCaddyOptions(): Promise<GlobalCaddyOptions> {
  const [s] = await db
    .select({
      acmeEmail: platformSettings.acmeEmail,
      httpsAutoRedirect: platformSettings.httpsAutoRedirect,
      trustedProxies: platformSettings.trustedProxies,
    })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return {
    acmeEmail: s?.acmeEmail ?? null,
    httpsAutoRedirect: s?.httpsAutoRedirect ?? true,
    trustedProxies: s?.trustedProxies ?? "",
  };
}

/** Persist the global Caddy options, then reconcile so they take effect. The
 *  contract validates each trusted-proxy entry against an address/CIDR
 *  charset and the builder drops anything that still doesn't parse, so this
 *  can't produce invalid global syntax; reconcile only swaps the live config
 *  in after a successful adapt, so a bad value can't take routes offline
 *  either. */
export async function saveGlobalCaddyOptions(
  // `trustedProxies` is optional because two surfaces write these options: the
  // instance Edge settings, which owns the field, and a project's Networking
  // editor, which predates it and knows nothing about it. Omitting it has to
  // mean "leave it alone" — spelling it as a required field would have let the
  // project editor silently reset the install's proxy trust to nothing, and
  // the next reconcile would put every visitor back behind the CDN's address.
  input: Omit<GlobalCaddyOptions, "trustedProxies"> & { trustedProxies?: string },
  rlog?: RequestLogger,
): Promise<GlobalCaddyOptions> {
  const acmeEmail = input.acmeEmail?.trim() || null;
  const trustedProxies =
    input.trustedProxies === undefined
      ? (await getGlobalCaddyOptions()).trustedProxies
      : input.trustedProxies.trim();
  const next = {
    acmeEmail,
    httpsAutoRedirect: input.httpsAutoRedirect,
    trustedProxies,
  };
  await db
    .insert(platformSettings)
    .values({ id: PLATFORM_SETTINGS_ID, ...next })
    .onConflictDoUpdate({ target: platformSettings.id, set: next });
  await reconcile(rlog);
  return next;
}

/** Org-scope the route lookup, then run one save-with-rollback on it. Shared
 *  by the policy and custom-directives mutations so both keep the same
 *  applied/error contract (the editor surfaces Caddy's own parse message). */
async function withRouteInOrg(
  input: OrgRef & { routeId: ProxyRouteId },
  save: (
    route: NonNullable<Awaited<ReturnType<typeof getRouteInOrg>>>,
  ) => Promise<SaveRoutePolicyResult>,
): Promise<Result<SaveRoutePolicyResult, ProxyRouteNotFoundError>> {
  const route = await getRouteInOrg(input.routeId, input.organizationId);
  if (!route) {
    return Result.err(new ProxyRouteNotFoundError({ routeId: input.routeId }));
  }
  return Result.ok(await save(route));
}

/** Persist the allowlisted route policy, then reconcile with rollback on error. */
export function setProxyRoutePolicy(
  input: OrgRef & { routeId: ProxyRouteId; policy: RoutePolicy },
  rlog?: RequestLogger,
): Promise<Result<SaveRoutePolicyResult, ProxyRouteNotFoundError>> {
  return withRouteInOrg(input, (route) => saveRoutePolicy(route, input.policy, rlog));
}

/** Persist raw per-route Caddyfile directives (od-f4rb) with the same
 *  reconcile-with-rollback contract as the policy save. */
export function setProxyRouteCustomDirectives(
  input: OrgRef & { routeId: ProxyRouteId; directives: string | null },
  rlog?: RequestLogger,
): Promise<Result<SaveRoutePolicyResult, ProxyRouteNotFoundError>> {
  // An emptied editor means "no custom block", not an empty string row.
  const directives = input.directives === "" ? null : input.directives;
  return withRouteInOrg(input, (route) => saveRouteCustomDirectives(route, directives, rlog));
}

export async function setProxyRouteProtection(
  input: OrgRef & { routeId: ProxyRouteId; protected: boolean },
  rlog?: RequestLogger,
): Promise<Result<ProxyRoute, ProxyRouteNotFoundError>> {
  const route = await getRouteInOrg(input.routeId, input.organizationId);
  if (!route) {
    return Result.err(new ProxyRouteNotFoundError({ routeId: input.routeId }));
  }

  const updated = await updateProxyRoute(input.routeId, {
    protected: input.protected,
  });
  if (!updated) {
    return Result.err(new ProxyRouteNotFoundError({ routeId: input.routeId }));
  }

  // Re-render the Caddyfile so the forward_auth gate is added/removed now.
  await reconcile(rlog);
  return Result.ok(updated);
}

/** The operator's route on/off switch. Writes `disabledByUser` (the wire
 *  speaks `enabled` for the UI's sake) rather than the system-owned `enabled`
 *  column, so expose/recheck can't silently overturn the choice: and all
 *  cert/verification state survives the round-trip. */
export async function setProxyRouteUserEnabled(
  input: OrgRef & { routeId: ProxyRouteId; enabled: boolean },
  rlog?: RequestLogger,
): Promise<Result<ProxyRoute, ProxyRouteNotFoundError>> {
  const route = await getRouteInOrg(input.routeId, input.organizationId);
  if (!route) {
    return Result.err(new ProxyRouteNotFoundError({ routeId: input.routeId }));
  }

  const updated = await updateProxyRoute(input.routeId, {
    disabledByUser: !input.enabled,
  });
  if (!updated) {
    return Result.err(new ProxyRouteNotFoundError({ routeId: input.routeId }));
  }

  // Re-render so the route drops out of (or returns to) Caddy immediately.
  await reconcile(rlog);
  return Result.ok(updated);
}

export async function createDeploymentShareLink(
  input: OrgRef & { routeId: ProxyRouteId; expiresInHours: number },
): Promise<Result<{ url: string; expiresAt: string }, ProxyRouteNotFoundError>> {
  const route = await getRouteInOrg(input.routeId, input.organizationId);
  if (!route) {
    return Result.err(new ProxyRouteNotFoundError({ routeId: input.routeId }));
  }

  const ttlSeconds = input.expiresInHours * 60 * 60;
  const token = await signGrantToken("share", route.domain, ttlSeconds);
  const url = `https://${route.domain}${RESERVED_AUTH_PREFIX}/share?token=${token}`;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  return Result.ok({ url, expiresAt });
}

export async function createDeploymentBypassToken(
  input: OrgRef & { routeId: ProxyRouteId; expiresInDays: number },
): Promise<Result<{ header: string; token: string; expiresAt: string }, ProxyRouteNotFoundError>> {
  const route = await getRouteInOrg(input.routeId, input.organizationId);
  if (!route) {
    return Result.err(new ProxyRouteNotFoundError({ routeId: input.routeId }));
  }

  const ttlSeconds = input.expiresInDays * 24 * 60 * 60;
  const token = await signGrantToken("bypass", route.domain, ttlSeconds);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  return Result.ok({ header: "x-otter-bypass", token, expiresAt });
}

// ─── Guests (email one-time PIN) ────────────────────────────────────

interface GuestView {
  id: string;
  email: string;
  sessionHours: number;
  createdAt: string;
}
const toGuestView = (g: GuestRecord): GuestView => ({
  id: g.id,
  email: g.email,
  sessionHours: g.sessionHours,
  createdAt: g.createdAt.toISOString(),
});

export async function listDeploymentGuests(
  input: OrgRef & { routeId: ProxyRouteId },
): Promise<Result<GuestView[], ProxyRouteNotFoundError>> {
  const route = await getRouteInOrg(input.routeId, input.organizationId);
  if (!route) {
    return Result.err(new ProxyRouteNotFoundError({ routeId: input.routeId }));
  }
  const guests = await listGuests(input.routeId);
  return Result.ok(guests.map(toGuestView));
}

export async function inviteDeploymentGuest(
  input: OrgRef & {
    routeId: ProxyRouteId;
    email: string;
    sessionHours: number;
    invitedByUserId?: string;
  },
): Promise<Result<GuestView, ProxyRouteNotFoundError>> {
  const route = await getRouteInOrg(input.routeId, input.organizationId);
  if (!route) {
    return Result.err(new ProxyRouteNotFoundError({ routeId: input.routeId }));
  }
  const guest = await upsertGuest({
    proxyRouteId: input.routeId,
    email: input.email,
    sessionHours: input.sessionHours,
    invitedByUserId: input.invitedByUserId,
  });
  return Result.ok(toGuestView(guest));
}

export async function removeDeploymentGuest(
  input: OrgRef & { routeId: ProxyRouteId; guestId: DeploymentGuestId },
): Promise<Result<{ ok: boolean }, ProxyRouteNotFoundError>> {
  const route = await getRouteInOrg(input.routeId, input.organizationId);
  if (!route) {
    return Result.err(new ProxyRouteNotFoundError({ routeId: input.routeId }));
  }
  // The contract sends guestId as a plain string. An id we never minted (wrong
  // prefix) can't match a row, so skipping the delete is the same no-op the
  // unmatched DELETE would have been.
  if (hasPrefix(input.guestId, ID_PREFIX.deploymentGuest)) {
    await removeGuest(input.routeId, input.guestId);
  }
  return Result.ok({ ok: true });
}
