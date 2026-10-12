/**
 * Series and boot registry. Creating a series is bounded by quotas, so a
 * misbehaving node cannot create unbounded cardinality (no URL, error-message
 * or label dimensions): a node's non-container series (host plus bounded
 * dimensions) and an organization's total. A series of an organization that does not
 * exist is refused the same way. Creation runs in its own short transaction
 * under advisory locks on the organization and the node, so concurrent
 * ingests in several processes cannot overshoot a quota. Resolved ids are
 * cached; a series row never changes identity.
 */
import { db } from "@otterdeploy/db";
import { organization } from "@otterdeploy/db/schema/auth";
import { healthBoot, healthCounters, healthSeries } from "@otterdeploy/db/schema/health-data";
import { Result } from "better-result";
import { and, count, eq, sql } from "drizzle-orm";

import { identityKey, isNodeDimension, type SeriesIdentity, seriesKindOf } from "./ingest-model";
import { nowMs } from "./model";
import { type HealthDbError, toDbError, type Tx } from "./sql";

export interface Quotas {
  /** Non-container metric series (host + bounded dimensions) per node. */
  nodeDimensions: number;
  /** Series per organization. */
  seriesPerOrg: number;
}

const DEFAULT_QUOTAS: Quotas = { nodeDimensions: 17, seriesPerOrg: 2_000 };

const lock = (key: string) =>
  sql`select pg_advisory_xact_lock(hashtextextended(${`health-series:${key}`}, 0))`;

/** Bump an operational counter (inside the caller's transaction). */
export const bumpCounter = (key: string, by = 1) =>
  sql`insert into ${healthCounters} (k, v) values (${key}, ${by})
      on conflict (k) do update set v = ${healthCounters.v} + excluded.v`;

export class SeriesRegistry {
  private readonly ids = new Map<string, number>();
  private readonly boots = new Map<string, number>();

  constructor(private readonly quotas: Quotas = DEFAULT_QUOTAS) {}

  /** The boot reference for (node, epoch, boot id), created on first sight. */
  async boot(source: {
    sourceNodeId: string;
    nodeEpoch: number;
    bootId: string;
  }): Promise<Result<number, HealthDbError>> {
    const key = JSON.stringify([source.sourceNodeId, source.nodeEpoch, source.bootId]);
    const known = this.boots.get(key);
    if (known !== undefined) return Result.ok(known);
    const r = await Result.tryPromise({
      catch: toDbError,
      try: () =>
        db
          .insert(healthBoot)
          .values({ ...source, createdAt: nowMs() })
          .onConflictDoUpdate({
            target: [healthBoot.sourceNodeId, healthBoot.nodeEpoch, healthBoot.bootId],
            set: { sourceNodeId: source.sourceNodeId },
          })
          .returning({ id: healthBoot.id }),
    });
    if (r.isErr()) return Result.err(r.error);
    const id = r.value[0]?.id;
    if (id === undefined) return Result.err(toDbError(new Error("boot upsert returned no row")));
    this.boots.set(key, id);
    return Result.ok(id);
  }

  /** An existing series id, or null; never creates one (markers name series, never make them). */
  async find(identity: SeriesIdentity): Promise<Result<number | null, HealthDbError>> {
    const key = identityKey(identity);
    const known = this.ids.get(key);
    if (known !== undefined) return Result.ok(known);
    const r = await Result.tryPromise({
      catch: toDbError,
      try: () =>
        db
          .select({ id: healthSeries.id })
          .from(healthSeries)
          .where(eq(healthSeries.identityKey, key))
          .$withCache(false),
    });
    return r.map((rows) => {
      const id = rows[0]?.id ?? null;
      if (id !== null) this.ids.set(key, id);
      return id;
    });
  }

  /** The series id, created under quota on first sight; null when a quota refuses it. */
  async resolve(identity: SeriesIdentity): Promise<Result<number | null, HealthDbError>> {
    const key = identityKey(identity);
    const known = this.ids.get(key);
    if (known !== undefined) return Result.ok(known);
    const r = await Result.tryPromise({
      catch: toDbError,
      try: () => db.transaction((tx) => this.create(tx, identity, key)),
    });
    if (r.isErr()) return Result.err(r.error);
    if (r.value !== null) this.ids.set(key, r.value);
    return Result.ok(r.value);
  }

  private async create(tx: Tx, identity: SeriesIdentity, key: string): Promise<number | null> {
    await tx.execute(lock(`org:${identity.organizationId}`));
    await tx.execute(lock(`node:${identity.sourceNodeId}`));
    const [existing] = await tx
      .select({ id: healthSeries.id })
      .from(healthSeries)
      .where(eq(healthSeries.identityKey, key))
      .$withCache(false);
    if (existing) return existing.id;
    const [org] = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, identity.organizationId))
      .$withCache(false);
    if (!org) {
      await tx.execute(bumpCounter("unknown_organization"));
      return null;
    }
    const nodeDimension = isNodeDimension(identity);
    if (await this.overQuota(tx, identity, nodeDimension)) {
      await tx.execute(bumpCounter("quota_rejected"));
      return null;
    }
    const [row] = await tx
      .insert(healthSeries)
      .values({
        organizationId: identity.organizationId,
        kind: seriesKindOf(identity),
        sourceNodeId: identity.sourceNodeId,
        identityKey: key,
        subjectId: identity.subjectId,
        dimensionSet: identity.kind === "metric" ? identity.dimensionSet : null,
        checkId: identity.kind === "probe" ? identity.checkId : null,
        checkRevision: identity.kind === "probe" ? identity.checkRevision : null,
        nodeDimension,
        createdAt: nowMs(),
      })
      .returning({ id: healthSeries.id });
    return row?.id ?? null;
  }

  private async overQuota(
    tx: Tx,
    identity: SeriesIdentity,
    nodeDimension: boolean,
  ): Promise<boolean> {
    const [org] = await tx
      .select({ n: count() })
      .from(healthSeries)
      .where(eq(healthSeries.organizationId, identity.organizationId))
      .$withCache(false);
    if ((org?.n ?? 0) >= this.quotas.seriesPerOrg) return true;
    if (!nodeDimension) return false;
    const [node] = await tx
      .select({ n: count() })
      .from(healthSeries)
      .where(
        and(
          eq(healthSeries.sourceNodeId, identity.sourceNodeId),
          eq(healthSeries.nodeDimension, true),
        ),
      )
      .$withCache(false);
    return (node?.n ?? 0) >= this.quotas.nodeDimensions;
  }
}
