/**
 * API-key project scope, enforced from a procedure's declared project
 * references (./project-refs.ts) for every org-scoped procedure.
 *
 * Each id the input names is resolved to its owning project (one query per
 * kind, inside the active organization) and the key must hold every one of
 * those projects. An id that resolves to nothing in the organization is left
 * to the handler, whose own NOT_FOUND is the right answer (a FORBIDDEN would
 * tell the caller the id exists); a `project` id needs no lookup, it is the
 * project. Strict no-op, before any query, for session actors and for keys
 * not restricted to selected projects.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { analyticsEventDefinition, analyticsSite } from "@otterdeploy/db/schema/analytics";
import { backup, backupSchedule } from "@otterdeploy/db/schema/backup";
import {
  deployment,
  environment,
  preview,
  project,
  resource,
} from "@otterdeploy/db/schema/project";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { inboundEndpoint } from "@otterdeploy/db/schema/webhooks";
import { idSchema } from "@otterdeploy/shared/id";
import { and, eq, inArray } from "drizzle-orm";
import * as z from "zod";

import type { ApiKeyActor } from "./actor";
import type { AuthorizationDecision } from "./capability";
import type { ProjectRefKind } from "./project-refs";

import { requireProjectScope } from "./api-key-scope";
import { inputProjectRefs, parseProjectRefs } from "./project-refs";

/** Only the ids a branded schema accepts can name a row; the rest are skipped.
 *  The schema also canonicalizes a legacy spelling (`resource_...`), exactly
 *  as the procedure's own input validation will before its handler runs. */
function branded<T>(schema: z.ZodType<T>, ids: ReadonlySet<string>): T[] {
  return [...ids].flatMap((id) => {
    const parsed = schema.safeParse(id);
    return parsed.success ? [parsed.data] : [];
  });
}

type OwningProjects = (
  ids: ReadonlySet<string>,
  organizationId: OrganizationId,
) => Promise<(string | null)[]>;

const inOrg = (organizationId: OrganizationId) => eq(project.organizationId, organizationId);

/** Per kind: the projects that own `ids` inside `organizationId`. */
const OWNING_PROJECTS: Readonly<Record<ProjectRefKind, OwningProjects>> = {
  // No lookup: the id IS the project. Canonical when it parses (a legacy
  // `project_...` spelling names the same project); anything else is compared
  // as sent, and a key never holds it.
  project: async (ids) =>
    [...ids].map((id) => {
      const parsed = idSchema.project.safeParse(id);
      return parsed.success ? parsed.data : id;
    }),
  projectSlug: async (ids, organizationId) => {
    const rows = await db
      .select({ projectId: project.id })
      .from(project)
      .where(and(inArray(project.slug, [...ids]), inOrg(organizationId)));
    return rows.map((row) => row.projectId);
  },
  resource: async (ids, organizationId) => {
    const wanted = branded(idSchema.resource, ids);
    if (wanted.length === 0) return [];
    const rows = await db
      .select({ projectId: resource.projectId })
      .from(resource)
      .innerJoin(project, eq(project.id, resource.projectId))
      .where(and(inArray(resource.id, wanted), inOrg(organizationId)));
    return rows.map((row) => row.projectId);
  },
  // A standalone (unclaimed) environment has no project: nothing to join.
  environment: async (ids, organizationId) => {
    const wanted = branded(idSchema.environment, ids);
    if (wanted.length === 0) return [];
    const rows = await db
      .select({ projectId: environment.projectId })
      .from(environment)
      .innerJoin(project, eq(project.id, environment.projectId))
      .where(and(inArray(environment.id, wanted), inOrg(organizationId)));
    return rows.map((row) => row.projectId);
  },
  proxyRoute: async (ids, organizationId) => {
    const wanted = branded(idSchema.proxyRoute, ids);
    if (wanted.length === 0) return [];
    const rows = await db
      .select({ projectId: proxyRoute.projectId })
      .from(proxyRoute)
      .innerJoin(project, eq(project.id, proxyRoute.projectId))
      .where(and(inArray(proxyRoute.id, wanted), inOrg(organizationId)));
    return rows.map((row) => row.projectId);
  },
  deployment: async (ids, organizationId) => {
    const wanted = branded(idSchema.deployment, ids);
    if (wanted.length === 0) return [];
    const rows = await db
      .select({ projectId: resource.projectId })
      .from(deployment)
      .innerJoin(resource, eq(resource.id, deployment.resourceId))
      .innerJoin(project, eq(project.id, resource.projectId))
      .where(and(inArray(deployment.id, wanted), inOrg(organizationId)));
    return rows.map((row) => row.projectId);
  },
  preview: async (ids, organizationId) => {
    const wanted = branded(idSchema.preview, ids);
    if (wanted.length === 0) return [];
    const rows = await db
      .select({ projectId: preview.projectId })
      .from(preview)
      .innerJoin(project, eq(project.id, preview.projectId))
      .where(and(inArray(preview.id, wanted), inOrg(organizationId)));
    return rows.map((row) => row.projectId);
  },
  // A volume backup has no resource and so no project.
  backup: async (ids, organizationId) => {
    const wanted = branded(idSchema.backup, ids);
    if (wanted.length === 0) return [];
    const rows = await db
      .select({ projectId: resource.projectId })
      .from(backup)
      .innerJoin(resource, eq(resource.id, backup.resourceId))
      .where(and(inArray(backup.id, wanted), eq(backup.organizationId, organizationId)));
    return rows.map((row) => row.projectId);
  },
  // An organization-wide schedule has a null project: nothing to confine.
  backupSchedule: async (ids, organizationId) => {
    const wanted = branded(idSchema.backupSchedule, ids);
    if (wanted.length === 0) return [];
    const rows = await db
      .select({ projectId: backupSchedule.projectId })
      .from(backupSchedule)
      .where(
        and(inArray(backupSchedule.id, wanted), eq(backupSchedule.organizationId, organizationId)),
      );
    return rows.map((row) => row.projectId);
  },
  // An endpoint bound to no resource redeploys nothing: no project.
  inboundEndpoint: async (ids, organizationId) => {
    const wanted = branded(idSchema.inboundEndpoint, ids);
    if (wanted.length === 0) return [];
    const rows = await db
      .select({ projectId: resource.projectId })
      .from(inboundEndpoint)
      .innerJoin(resource, eq(resource.id, inboundEndpoint.resourceId))
      .where(
        and(
          inArray(inboundEndpoint.id, wanted),
          eq(inboundEndpoint.organizationId, organizationId),
        ),
      );
    return rows.map((row) => row.projectId);
  },
  analyticsEventDefinition: async (ids, organizationId) => {
    const wanted = branded(idSchema.analyticsEventDefinition, ids);
    if (wanted.length === 0) return [];
    const rows = await db
      .select({ projectId: analyticsSite.projectId })
      .from(analyticsEventDefinition)
      .innerJoin(analyticsSite, eq(analyticsSite.id, analyticsEventDefinition.siteId))
      .where(
        and(
          inArray(analyticsEventDefinition.id, wanted),
          eq(analyticsSite.organizationId, organizationId),
        ),
      );
    return rows.map((row) => row.projectId);
  },
};

const ALLOWED: AuthorizationDecision = { allowed: true };

/**
 * May this actor make this call, as far as the key's project scope goes?
 * `meta` is the procedure's contract meta (its `projectRefs` declaration).
 */
export async function authorizeProjectRefs(
  apiKey: ApiKeyActor | null,
  organizationId: OrganizationId,
  meta: unknown,
  input: unknown,
): Promise<AuthorizationDecision> {
  if (!apiKey || apiKey.projectScope !== "selected") return ALLOWED;
  const declared = parseProjectRefs(meta);
  if (!declared) {
    return {
      allowed: false,
      status: 403,
      reason: "This procedure's project references are malformed; a project-scoped key is refused.",
    };
  }
  const { refs, undeclared } = inputProjectRefs(input, declared);
  if (undeclared.length > 0) {
    return {
      allowed: false,
      status: 403,
      reason: `This API key is limited to selected projects, and the project of ${undeclared.join(", ")} is not declared.`,
    };
  }
  for (const [kind, ids] of refs) {
    for (const projectId of await OWNING_PROJECTS[kind](ids, organizationId)) {
      if (projectId !== null && !requireProjectScope(apiKey, projectId)) {
        return {
          allowed: false,
          status: 403,
          reason: "This API key is not scoped to that project.",
        };
      }
    }
  }
  return ALLOWED;
}
