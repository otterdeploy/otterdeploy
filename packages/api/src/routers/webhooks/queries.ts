import type {
  InboundEndpointId,
  OrganizationId,
  ResourceId,
  WebhookId,
} from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  type InboundEndpointRow,
  type WebhookRow,
  inboundEndpoint,
  project,
  resource,
  webhook,
  webhookDelivery,
} from "@otterdeploy/db/schema";
/**
 * Org-scoped DB queries + presenters for the webhooks router. Webhook rows
 * are enriched with delivery stats (total attempts, success rate, last
 * delivery, 24h failures) computed from `webhook_delivery`; inbound rows are
 * joined to their bound service resource + project for display. Secrets are
 * never selected into a view.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";

// ─── Outbound ────────────────────────────────────────────────────────────

export interface WebhookStats {
  totalDeliveries: number;
  successRate: number | null;
  lastDelivery: Date | null;
  failed24h: number;
}

export interface WebhookView {
  id: WebhookId;
  url: string;
  events: string[];
  status: "active" | "paused" | "failing";
  totalDeliveries: number;
  successRate: number | null;
  lastDelivery: string | null;
  failed24h: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function listWebhookRows(organizationId: OrganizationId): Promise<WebhookRow[]> {
  return db
    .select()
    .from(webhook)
    .where(eq(webhook.organizationId, organizationId))
    .orderBy(webhook.createdAt);
}

export async function getWebhookRow(input: {
  organizationId: OrganizationId;
  id: WebhookId;
}): Promise<WebhookRow | null> {
  const [row] = await db
    .select()
    .from(webhook)
    .where(and(eq(webhook.id, input.id), eq(webhook.organizationId, input.organizationId)));
  return row ?? null;
}

/** Per-webhook delivery stats for an org, keyed by webhook id. */
export async function statsByWebhook(
  organizationId: OrganizationId,
): Promise<Map<string, WebhookStats>> {
  const rows = await db
    .select({
      webhookId: webhookDelivery.webhookId,
      total: sql<number>`count(*)`.mapWith(Number),
      okCount: sql<number>`count(*) filter (where ${webhookDelivery.ok})`.mapWith(Number),
      lastDelivery: sql<Date | null>`max(${webhookDelivery.createdAt})`,
      failed24h:
        sql<number>`count(*) filter (where not ${webhookDelivery.ok} and ${webhookDelivery.createdAt} >= now() - interval '24 hours')`.mapWith(
          Number,
        ),
    })
    .from(webhookDelivery)
    .where(eq(webhookDelivery.organizationId, organizationId))
    .groupBy(webhookDelivery.webhookId);

  const map = new Map<string, WebhookStats>();
  for (const r of rows) {
    map.set(r.webhookId, {
      totalDeliveries: r.total,
      successRate: r.total > 0 ? Math.round((r.okCount / r.total) * 1000) / 10 : null,
      lastDelivery: r.lastDelivery ? new Date(r.lastDelivery) : null,
      failed24h: r.failed24h,
    });
  }
  return map;
}

export function toWebhookView(row: WebhookRow, stats: WebhookStats | undefined): WebhookView {
  const failed24h = stats?.failed24h ?? 0;
  // Effective status: stored `paused` wins; recent failures degrade an
  // active webhook to `failing` (derived, never stored).
  const status: WebhookView["status"] =
    row.status === "active" && failed24h > 0 ? "failing" : row.status;
  return {
    id: row.id,
    url: row.url,
    events: row.events,
    status,
    totalDeliveries: stats?.totalDeliveries ?? 0,
    successRate: stats?.successRate ?? null,
    lastDelivery: stats?.lastDelivery ? stats.lastDelivery.toISOString() : null,
    failed24h,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function insertWebhook(values: {
  organizationId: OrganizationId;
  url: string;
  events: string[];
  encryptedSecret: string;
}): Promise<WebhookRow> {
  const [row] = await db.insert(webhook).values(values).returning();
  if (!row) throw new Error("insertWebhook: insert returned no row");
  return row;
}

export async function updateWebhook(
  input: { organizationId: OrganizationId; id: WebhookId },
  patch: Partial<{ url: string; events: string[]; status: "active" | "paused" }>,
): Promise<WebhookRow | null> {
  const [row] = await db
    .update(webhook)
    .set(patch)
    .where(and(eq(webhook.id, input.id), eq(webhook.organizationId, input.organizationId)))
    .returning();
  return row ?? null;
}

export async function deleteWebhook(input: {
  organizationId: OrganizationId;
  id: WebhookId;
}): Promise<boolean> {
  const rows = await db
    .delete(webhook)
    .where(and(eq(webhook.id, input.id), eq(webhook.organizationId, input.organizationId)))
    .returning({ id: webhook.id });
  return rows.length > 0;
}

// ─── Deliveries ──────────────────────────────────────────────────────────

export interface DeliveryView {
  id: (typeof webhookDelivery.$inferSelect)["id"];
  webhookId: WebhookId;
  target: string;
  event: string;
  statusCode: number | null;
  ok: boolean;
  attempt: number;
  latencyMs: number;
  error: string | null;
  createdAt: Date;
}

/** Hostname of a URL for the deliveries "Target" column; falls back to the
 * raw string when unparsable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export async function listRecentDeliveries(
  organizationId: OrganizationId,
  limit: number,
): Promise<DeliveryView[]> {
  const rows = await db
    .select({
      id: webhookDelivery.id,
      webhookId: webhookDelivery.webhookId,
      url: webhook.url,
      event: webhookDelivery.event,
      statusCode: webhookDelivery.statusCode,
      ok: webhookDelivery.ok,
      attempt: webhookDelivery.attempt,
      latencyMs: webhookDelivery.latencyMs,
      error: webhookDelivery.error,
      createdAt: webhookDelivery.createdAt,
    })
    .from(webhookDelivery)
    .innerJoin(webhook, eq(webhook.id, webhookDelivery.webhookId))
    .where(eq(webhookDelivery.organizationId, organizationId))
    .orderBy(desc(webhookDelivery.createdAt))
    .limit(limit);

  return rows.map(({ url, ...r }) => ({ ...r, target: hostOf(url) }));
}

// ─── Inbound ─────────────────────────────────────────────────────────────

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

type InboundJoinedRow = {
  endpoint: InboundEndpointRow;
  resourceName: string | null;
  projectSlug: string | null;
};

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
