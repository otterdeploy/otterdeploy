/**
 * Inbound-endpoint queries + presenters for the webhooks router — endpoint
 * CRUD, the public token lookup, and the redeploy-target service picker.
 * Split out of queries.ts (which keeps the outbound webhook + delivery
 * queries and re-exports this module).
 */
import type { InboundEndpointId, OrganizationId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  type InboundEndpointRow,
  inboundEndpoint,
  project,
  resource,
} from "@otterdeploy/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export interface InboundView {
  id: InboundEndpointId;
  name: string;
  token: string;
  action: "redeploy" | "none";
  resourceId: ResourceId | null;
  resourceName: string | null;
  projectSlug: string | null;
  ipAllowlist: string[];
  lastInvokedAt: string | null;
  status: "active" | "paused";
  createdAt: Date;
  updatedAt: Date;
}

interface InboundJoinedRow {
  endpoint: InboundEndpointRow;
  resourceName: string | null;
  projectSlug: string | null;
}

function toInboundView(row: InboundJoinedRow): InboundView {
  const e = row.endpoint;
  return {
    id: e.id,
    name: e.name,
    token: e.token,
    action: e.action,
    resourceId: e.resourceId,
    resourceName: row.resourceName,
    projectSlug: row.projectSlug,
    ipAllowlist: e.ipAllowlist,
    lastInvokedAt: e.lastInvokedAt ? e.lastInvokedAt.toISOString() : null,
    status: e.status,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

const inboundJoinedSelect = {
  endpoint: inboundEndpoint,
  resourceName: resource.name,
  projectSlug: project.slug,
};

export async function listInboundViews(organizationId: OrganizationId): Promise<InboundView[]> {
  const rows = await db
    .select(inboundJoinedSelect)
    .from(inboundEndpoint)
    .leftJoin(resource, eq(resource.id, inboundEndpoint.resourceId))
    .leftJoin(project, eq(project.id, resource.projectId))
    .where(eq(inboundEndpoint.organizationId, organizationId))
    .orderBy(inboundEndpoint.createdAt);
  return rows.map(toInboundView);
}

export async function getInboundView(input: {
  organizationId: OrganizationId;
  id: InboundEndpointId;
}): Promise<InboundView | null> {
  const [row] = await db
    .select(inboundJoinedSelect)
    .from(inboundEndpoint)
    .leftJoin(resource, eq(resource.id, inboundEndpoint.resourceId))
    .leftJoin(project, eq(project.id, resource.projectId))
    .where(
      and(
        eq(inboundEndpoint.id, input.id),
        eq(inboundEndpoint.organizationId, input.organizationId),
      ),
    );
  return row ? toInboundView(row) : null;
}

export async function getInboundRow(input: {
  organizationId: OrganizationId;
  id: InboundEndpointId;
}): Promise<InboundEndpointRow | null> {
  const [row] = await db
    .select()
    .from(inboundEndpoint)
    .where(
      and(
        eq(inboundEndpoint.id, input.id),
        eq(inboundEndpoint.organizationId, input.organizationId),
      ),
    );
  return row ?? null;
}

export async function insertInboundEndpoint(values: {
  organizationId: OrganizationId;
  name: string;
  token: string;
  encryptedSecret: string;
  action: "redeploy" | "none";
  resourceId: ResourceId | null;
  ipAllowlist: string[];
}): Promise<InboundEndpointRow> {
  const [row] = await db.insert(inboundEndpoint).values(values).returning();
  if (!row) throw new Error("insertInboundEndpoint: insert returned no row");
  return row;
}

export async function updateInboundEndpoint(
  input: { organizationId: OrganizationId; id: InboundEndpointId },
  patch: Partial<{
    name: string;
    action: "redeploy" | "none";
    resourceId: ResourceId | null;
    ipAllowlist: string[];
    status: "active" | "paused";
  }>,
): Promise<InboundEndpointRow | null> {
  const [row] = await db
    .update(inboundEndpoint)
    .set(patch)
    .where(
      and(
        eq(inboundEndpoint.id, input.id),
        eq(inboundEndpoint.organizationId, input.organizationId),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteInboundEndpoint(input: {
  organizationId: OrganizationId;
  id: InboundEndpointId;
}): Promise<boolean> {
  const rows = await db
    .delete(inboundEndpoint)
    .where(
      and(
        eq(inboundEndpoint.id, input.id),
        eq(inboundEndpoint.organizationId, input.organizationId),
      ),
    )
    .returning({ id: inboundEndpoint.id });
  return rows.length > 0;
}

/**
 * The full inbound-invocation context, resolved by public token — endpoint +
 * the bound service's project coordinates (needed by redeployAndFanOut).
 * Public-path lookup: no org scoping (the token IS the identifier).
 */
export interface InboundInvocationContext {
  endpoint: InboundEndpointRow;
  service: { resourceId: ResourceId; resourceName: string } | null;
  projectId: (typeof project.$inferSelect)["id"] | null;
  projectSlug: string | null;
}

export async function getInboundByToken(token: string): Promise<InboundInvocationContext | null> {
  const [row] = await db
    .select({
      endpoint: inboundEndpoint,
      resourceId: resource.id,
      resourceName: resource.name,
      projectId: project.id,
      projectSlug: project.slug,
    })
    .from(inboundEndpoint)
    .leftJoin(resource, eq(resource.id, inboundEndpoint.resourceId))
    .leftJoin(project, eq(project.id, resource.projectId))
    .where(eq(inboundEndpoint.token, token));
  if (!row) return null;
  return {
    endpoint: row.endpoint,
    service:
      row.resourceId && row.resourceName
        ? { resourceId: row.resourceId, resourceName: row.resourceName }
        : null,
    projectId: row.projectId,
    projectSlug: row.projectSlug,
  };
}

export async function touchInboundInvokedAt(id: InboundEndpointId): Promise<void> {
  await db
    .update(inboundEndpoint)
    .set({ lastInvokedAt: new Date() })
    .where(eq(inboundEndpoint.id, id));
}

// ─── Service options (redeploy target picker) ────────────────────────────

export interface ServiceOption {
  resourceId: ResourceId;
  name: string;
  projectName: string;
  projectSlug: string;
}

/** Base (non-preview) service resources across the org, for the picker. */
export async function listServiceOptions(organizationId: OrganizationId): Promise<ServiceOption[]> {
  return db
    .select({
      resourceId: resource.id,
      name: resource.name,
      projectName: project.name,
      projectSlug: project.slug,
    })
    .from(resource)
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(
      and(
        eq(project.organizationId, organizationId),
        eq(resource.type, "service"),
        isNull(resource.previewId),
      ),
    )
    .orderBy(project.name, resource.name);
}

/** Scope check: the resource must be a service in the caller's org. */
export async function serviceBelongsToOrg(input: {
  organizationId: OrganizationId;
  resourceId: ResourceId;
}): Promise<boolean> {
  const [row] = await db
    .select({ id: resource.id })
    .from(resource)
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(
      and(
        eq(resource.id, input.resourceId),
        eq(resource.type, "service"),
        eq(project.organizationId, input.organizationId),
      ),
    );
  return Boolean(row);
}
