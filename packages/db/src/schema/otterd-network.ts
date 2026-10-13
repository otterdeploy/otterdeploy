import { bigint, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { otterdService } from "./otterd";

/**
 * The control plane's side of the node network: the fleet address plan, the
 * network scopes (one per environment) and the serving set last published
 * for each stable service address.
 *
 * The plan is one document in the node plan's own JSON form, written with
 * an optimistic revision check inside the transaction that allocates from
 * it. Addresses a peer may still forward to stay in its quarantine until
 * every such peer acknowledges or is fenced; VIPs and resolver addresses are
 * never reused.
 */
export const otterdAddressPlan = pgTable("otterd_address_plan", {
  /** Always 1: one plan per install. */
  id: integer("id").primaryKey(),
  plan: jsonb("plan").$type<Record<string, unknown>>().notNull(),
  revision: integer("revision").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

/** One network scope (an environment): its DNS zone and resolver listener address. */
export const otterdScope = pgTable("otterd_scope", {
  scopeId: text("scope_id").primaryKey(),
  zone: text("zone").notNull(),
  resolver: text("resolver").notNull().unique(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export interface ServingAttempt {
  grantId: string;
  attemptId: string;
  nodeId: string;
  nodeEpoch: number;
  address: string;
}

export interface ServingWithdrawal {
  attemptId: string;
  withdrawalRevision: number;
  drainBudgetMs: number;
  withdrawnAt: number;
}

export interface ServingSent {
  revision: number;
  sessionId: string;
  digests: { revision: number; digest: string }[];
  /** The newest revision the node acknowledged installing. */
  installed?: number;
}

/**
 * The serving set last published for one VIP service, the nodes each
 * attempt was announced to (the peers an address release waits for) and the
 * revision each node was last sent on which session.
 */
export const otterdServing = pgTable("otterd_serving", {
  resourceId: text("resource_id")
    .primaryKey()
    .references(() => otterdService.resourceId, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  attempts: jsonb("attempts").$type<ServingAttempt[]>().notNull(),
  withdrawals: jsonb("withdrawals").$type<ServingWithdrawal[]>().notNull(),
  /** attempt id → nodes that were sent a set listing it. */
  listed: jsonb("listed").$type<Record<string, string[]>>().notNull(),
  /**
   * node id → the revision and session it was last sent on, and the payload
   * digests of the recent revisions it was sent: an acknowledgement must name
   * one of these exactly.
   */
  sentTo: jsonb("sent_to").$type<Record<string, ServingSent>>().notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
