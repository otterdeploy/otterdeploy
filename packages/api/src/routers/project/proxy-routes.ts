/**
 * Proxy-route orchestration. Surfaces the Caddy proxy routes scoped to a
 * project so the dashboard can render the routing table, plus the
 * deployment-protection control surface: toggle the auth wall, mint
 * shareable links + automation-bypass tokens. See
 * docs/designs/deployment-protection.md.
 */

import type { DeploymentGuestId, ProxyRouteId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import type { OrgRef, ProjectRef } from "../scopes";

import { type GuestRecord, listGuests, removeGuest, upsertGuest } from "../../authz/guests";
import { signGrantToken } from "../../authz/tokens";
import {
  reconcile,
  renderProjectCaddyfile,
  saveProjectCustomConfig,
  saveRouteCustomDirectives,
  type ProjectCaddyfile,
  type SaveCustomConfigResult,
  type SaveRouteDirectivesResult,
} from "../../caddy";
import { RESERVED_AUTH_PREFIX } from "../../caddy/builder";
import {
  getProjectCustomConfig,
  listProxyRoutesByProject,
  updateProxyRoute,
} from "../../caddy/queries";
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

  const records = await listProxyRoutesByProject(input.projectId);
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

/** Read a project's raw custom Caddy config for the editor (org-scoped). */
export async function getProjectCustomCaddyConfig(
  input: ProjectRef,
): Promise<Result<{ config: string | null }, ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }
  const config = await getProjectCustomConfig(input.projectId);
  return Result.ok({ config });
}

/** Validate + persist a project's custom Caddy config, then reconcile. Invalid
 *  config is rejected (not saved) with Caddy's error so the live edge stays
 *  intact — see saveProjectCustomConfig. */
export async function saveProjectCustomCaddyConfig(
  input: ProjectRef & { config: string | null },
  rlog?: RequestLogger,
): Promise<Result<SaveCustomConfigResult, ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }
  const result = await saveProjectCustomConfig(input.projectId, input.config, rlog);
  return Result.ok(result);
}

export interface GlobalCaddyOptions {
  /** ACME registration email (Let's Encrypt). Null = none configured. */
  acmeEmail: string | null;
  /** Caddy auto HTTP→HTTPS redirect. Defaults on. */
  httpsAutoRedirect: boolean;
}

/** Read the instance-wide global Caddy options (the `platform_settings`
 *  singleton). Org-agnostic — there's one edge proxy per install. */
export async function getGlobalCaddyOptions(): Promise<GlobalCaddyOptions> {
  const [s] = await db
    .select({
      acmeEmail: platformSettings.acmeEmail,
      httpsAutoRedirect: platformSettings.httpsAutoRedirect,
    })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return {
    acmeEmail: s?.acmeEmail ?? null,
    httpsAutoRedirect: s?.httpsAutoRedirect ?? true,
  };
}

/** Persist the global Caddy options, then reconcile so they take effect. These
 *  options (an email + a redirect toggle) can't produce invalid global syntax,
 *  and reconcile only swaps the live config in after a successful adapt — so a
 *  bad value can't take routes offline. */
export async function saveGlobalCaddyOptions(
  input: GlobalCaddyOptions,
  rlog?: RequestLogger,
): Promise<GlobalCaddyOptions> {
  const acmeEmail = input.acmeEmail?.trim() || null;
  const next = { acmeEmail, httpsAutoRedirect: input.httpsAutoRedirect };
  await db
    .insert(platformSettings)
    .values({ id: PLATFORM_SETTINGS_ID, ...next })
    .onConflictDoUpdate({ target: platformSettings.id, set: next });
  await reconcile(rlog);
  return next;
}

/** Validate + persist per-route custom directives, then reconcile. */
export async function setProxyRouteDirectives(
  input: OrgRef & { routeId: ProxyRouteId; directives: string | null },
  rlog?: RequestLogger,
): Promise<Result<SaveRouteDirectivesResult, ProxyRouteNotFoundError>> {
  const route = await getRouteInOrg(input.routeId, input.organizationId);
  if (!route) {
    return Result.err(new ProxyRouteNotFoundError({ routeId: input.routeId }));
  }
  const result = await saveRouteCustomDirectives(route, input.directives, rlog);
  return Result.ok(result);
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
  input: OrgRef & { routeId: ProxyRouteId; guestId: string },
): Promise<Result<{ ok: boolean }, ProxyRouteNotFoundError>> {
  const route = await getRouteInOrg(input.routeId, input.organizationId);
  if (!route) {
    return Result.err(new ProxyRouteNotFoundError({ routeId: input.routeId }));
  }
  await removeGuest(input.routeId, input.guestId as DeploymentGuestId);
  return Result.ok({ ok: true });
}
