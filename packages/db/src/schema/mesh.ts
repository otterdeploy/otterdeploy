import type { MeshNetworkId, OrganizationId } from "@otterdeploy/shared/id";

// Private networking: the org's OWN connected VPN account (NetBird first,
// Tailscale behind the same provider interface). One row per org, exactly like
// `gitProvider`: bring-your-own credentials, encrypted at rest, never env vars.
//
// We deliberately do NOT run a shared platform mesh. Cross-org isolation would
// then rest entirely on our own ACL correctness. Peers, policies and billing
// live on the org's side, which is also the only model under which "reachable
// from my own devices only" can actually be true.
//
// The whole feature is OPTIONAL: no row for an org ⇒ nothing about that org's
// networking changes, no sidecar runs, and every route stays `public`.
// Design: docs/designs/vpn-mesh.md
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";

export const meshProviderKindEnum = pgEnum("mesh_provider_kind", ["netbird", "tailscale"]);

// Connection lifecycle. "connected" = the last verify() call succeeded.
// "error" = credentials were accepted once but the most recent verify failed
// (revoked token, unreachable self-hosted management server, scope drift).
// The row is kept so the operator can re-authenticate without re-entering
// everything and, critically, so private routes are reported as DRIFT rather
// than silently re-exposed publicly. "disconnected" = the operator
// deliberately unlinked; existing peers keep running untouched.
export const meshNetworkStatusEnum = pgEnum("mesh_network_status", [
  "connected",
  "error",
  "disconnected",
]);

export const meshNetwork = pgTable(
  "mesh_network",
  {
    id: text("id")
      .primaryKey()
      .$type<MeshNetworkId>()
      .$defaultFn(() => createId(ID_PREFIX.meshNetwork)),
    organizationId: text("organization_id")
      .notNull()
      .$type<OrganizationId>()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: meshProviderKindEnum("provider").notNull(),
    // Management API base. Hosted NetBird is https://api.netbird.io; a
    // self-hosted management server is the ONLY difference between the two
    // deployment modes, which is why they share one provider implementation.
    managementUrl: text("management_url").notNull(),
    // NetBird personal access token / Tailscale OAuth client secret, AES-GCM
    // ciphertext under the "mesh-creds" domain (packages/api/src/lib/crypto.ts).
    // Never leaves the server; no output schema ever includes it.
    apiTokenCiphertext: text("api_token_ciphertext").notNull(),
    // Non-secret half of a Tailscale OAuth client. Null for NetBird (a PAT has
    // no public half).
    oauthClientId: text("oauth_client_id"),
    // Provider-side account (NetBird) / tailnet (Tailscale) identifier, read
    // back from verify(), never operator input.
    accountId: text("account_id"),
    // The peer DNS zone this account resolves names under. Usually
    // "netbird.cloud", but accounts CAN change it, so it is read from the API
    // at connect rather than assumed, getting this wrong silently breaks
    // every private hostname.
    peerDomain: text("peer_domain"),
    // The wildcard DNS label our nodes register (`--extra-dns-labels "*.od"`),
    // giving every private service on a node a resolvable internal hostname
    // `<svc>-<project>.<dnsLabel>.<peerDomain>` with no per-service API call
    // and no external DNS. See the "DNS keystone" section of the design.
    dnsLabel: text("dns_label").notNull().default("od"),
    // Provider group (NetBird) / tag (Tailscale) that otterdeploy nodes join.
    nodeGroupId: text("node_group_id"),
    // Provider groups permitted to REACH private services. Empty ⇒ nothing is
    // reachable, which is the correct zero-trust default: NetBird grants no
    // access until a policy says so, and we don't invent one on the org's
    // behalf.
    accessGroupIds: jsonb("access_group_ids").$type<string[]>().notNull().default([]),
    status: meshNetworkStatusEnum("status").notNull().default("connected"),
    lastVerifiedAt: timestamp("last_verified_at"),
    // Human-readable reason the last verify failed; cleared on success.
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // One mesh per org: the connect flow upserts on this.
    uniqueIndex("mesh_network_org_unique").on(table.organizationId),
    index("mesh_network_status_idx").on(table.status),
  ],
);
