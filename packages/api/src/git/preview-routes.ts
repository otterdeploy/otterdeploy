/**
 * Preview-environment proxy routes — the `web-pr-13-<project>.<base>` hosts
 * that make a PR's containers reachable (docs/designs/pr-previews.md §7.4).
 *
 * Minted when the PR webhook ensures the env (so the host exists by the time
 * the build converges — Caddy 502s until the container is up, which the PR
 * comment reflects as "Building"), refreshed on synchronize, deleted on
 * teardown. Env-scoped rows (`proxy_route.environmentId`) are invisible to
 * the base domain flows (expose/domains-card read `environmentId IS NULL`),
 * so a preview can never steal a service's primary host.
 */
import type { GitRepoId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { resource, serviceResource } from "@otterdeploy/db/schema/project";
import { and, eq, isNull } from "drizzle-orm";

import type { EnvScope } from "../lib/environment/scoping";

import {
  deleteProxyRoutesByEnvironment,
  insertProxyRoute,
  listProxyRoutesByEnvironment,
  updateProxyRoute,
} from "../caddy/queries";
import { loadDomainSourcesForProject } from "../lib/domain-sources";
import { resolvePublicDomain } from "../lib/domains";
import { previewHostLabel, runtimeServiceName } from "../lib/environment/scoping";
import { getPrimaryHttpPort, listServicePorts } from "../routers/service/queries";
import { sanitizeSlug } from "../routers/service/views";

export interface EnsurePreviewRoutesInput {
  projectId: ProjectId;
  projectSlug: string;
  gitRepoId: GitRepoId;
  env: EnvScope;
}

/**
 * Mint (or refresh) one generated route per publicly-exposed git service the
 * PR rebuilds. Returns whether anything changed so the caller can decide to
 * reconcile Caddy. Idempotent per (environment, resource) — synchronize
 * reuses the existing host.
 */
export async function ensurePreviewRoutes(input: EnsurePreviewRoutesInput): Promise<boolean> {
  const services = await db
    .select({
      resourceId: resource.id,
      name: resource.name,
      serviceName: serviceResource.serviceName,
      publicEnabled: serviceResource.publicEnabled,
    })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(
      and(
        eq(resource.projectId, input.projectId),
        eq(resource.type, "service"),
        eq(serviceResource.source, "git"),
        eq(serviceResource.gitRepoId, input.gitRepoId),
        eq(serviceResource.previewsEnabled, true),
        isNull(resource.environmentId),
      ),
    );
  const exposed = services.filter((s) => s.publicEnabled);
  if (exposed.length === 0) return false;

  const sources = await loadDomainSourcesForProject(input.projectId);
  if (!sources) return false;

  const existing = await listProxyRoutesByEnvironment(input.env.id);
  const projectSlug = sanitizeSlug(input.projectSlug);
  let changed = false;

  for (const svc of exposed) {
    const primary = getPrimaryHttpPort(await listServicePorts(svc.resourceId as ResourceId));
    if (!primary) continue;
    const upstreamHost = runtimeServiceName(svc.serviceName, input.env);

    const route = existing.find((r) => r.resourceId === svc.resourceId);
    if (route) {
      if (route.upstreamHost !== upstreamHost || route.upstreamPort !== primary.containerPort) {
        await updateProxyRoute(route.id, {
          upstreamHost,
          upstreamPort: primary.containerPort,
        });
        changed = true;
      }
      continue;
    }

    // The preview host walks the same chain as the base generated host, with
    // the pr-suffixed label — never the per-resource publicDomain override
    // (that literal FQDN belongs to production).
    const resolved = resolvePublicDomain(
      {
        resourceSlug: previewHostLabel(sanitizeSlug(svc.name), input.env),
        projectSlug,
        kind: "service",
      },
      { ...sources, resourceOverride: null },
    );
    await insertProxyRoute({
      projectId: input.projectId,
      resourceId: svc.resourceId as ResourceId,
      environmentId: input.env.id,
      type: "http",
      domain: resolved.fqdn,
      upstreamHost,
      upstreamPort: primary.containerPort,
      protocol: "http",
      usesAcme: resolved.verified && resolved.source !== "sslip-fallback",
      enabled: true,
      source: "generated",
      isPrimary: false,
      dnsState: "pointed",
    });
    changed = true;
  }
  return changed;
}

/** Drop every route the preview env owns. Returns whether any existed so the
 *  caller can skip the Caddy reconcile on a no-op. */
export async function removePreviewRoutes(environmentId: EnvScope["id"]): Promise<boolean> {
  const routes = await listProxyRoutesByEnvironment(environmentId);
  if (routes.length === 0) return false;
  await deleteProxyRoutesByEnvironment(environmentId);
  return true;
}
