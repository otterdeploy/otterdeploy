import type { OrganizationId, WebhookId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { type WebhookRow, webhook, webhookDelivery } from "@otterdeploy/db/schema";
/**
 * Org-scoped DB queries + presenters for the webhooks router. Webhook rows
 * are enriched with delivery stats (total attempts, success rate, last
 * delivery, 24h failures) computed from `webhook_delivery`; inbound-endpoint
 * queries live in queries-inbound.ts (re-exported here). Secrets are never
 * selected into a view.
 */
import { and, desc, eq, sql } from "drizzle-orm";

export * from "./queries-inbound";

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
