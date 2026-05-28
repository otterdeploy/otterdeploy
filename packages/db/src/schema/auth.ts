import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import type { AccountId, InvitationId, MemberId, OrganizationId, SessionId, VerificationId } from "@otterdeploy/shared/id";
import { pgTable, text, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
export const user = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId(ID_PREFIX.user)),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id")
      .primaryKey()
      .$type<SessionId>()
      .$defaultFn(() => createId(ID_PREFIX.session)),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    activeOrganizationId: text("active_organization_id"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id")
      .primaryKey()
      .$type<AccountId>()
      .$defaultFn(() => createId(ID_PREFIX.account)),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

// Device Authorization Grant (RFC 8628). One row per outstanding device-code
// pairing — created when a CLI calls /device/code, claimed by the user from
// a browser at /device, then exchanged for an access_token via /device/token.
// Rows expire (default 30m) and are cleaned up by better-auth.
export const deviceCode = pgTable(
  "device_code",
  {
    id: text("id").primaryKey(),
    deviceCode: text("device_code").notNull().unique(),
    userCode: text("user_code").notNull().unique(),
    userId: text("user_id"),
    clientId: text("client_id"),
    scope: text("scope"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at").notNull(),
    lastPolledAt: timestamp("last_polled_at"),
    pollingInterval: integer("polling_interval"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("device_code_user_code_idx").on(table.userCode),
    index("device_code_device_code_idx").on(table.deviceCode),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id")
      .primaryKey()
      .$type<VerificationId>()
      .$defaultFn(() => createId(ID_PREFIX.verification)),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const organization = pgTable("organization", {
  id: text("id")
    .primaryKey()
    .$type<OrganizationId>()
    .$defaultFn(() => createId(ID_PREFIX.organization)),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  // Apex domain the org's resources are published under. When set + verified,
  // a service `web` in project `myproj` lands at `web-myproj.apps.<baseDomain>`
  // and a database lands at `redis-myproj.db.<baseDomain>`. Falls back to
  // PLATFORM.publicBaseDomain when null, or sslip.io for localhost dev. The
  // verified flag gates ACME issuance — Caddy only tries Let's Encrypt for
  // domains the operator has proven control of.
  baseDomain: text("base_domain"),
  baseDomainVerifiedAt: timestamp("base_domain_verified_at"),
  baseDomainVerifyToken: text("base_domain_verify_token"),
  // Cloudflare DNS API integration (optional). Token must carry
  // `Zone.DNS:Edit` scope on the chosen zone. Stored as-is for v1; should
  // move to encrypted secret storage once the secrets pipeline lands.
  cloudflareApiToken: text("cloudflare_api_token"),
  cloudflareZoneId: text("cloudflare_zone_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const member = pgTable(
  "member",
  {
    id: text("id")
      .primaryKey()
      .$type<MemberId>()
      .$defaultFn(() => createId(ID_PREFIX.member)),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id")
      .primaryKey()
      .$type<InvitationId>()
      .$defaultFn(() => createId(ID_PREFIX.invitation)),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    teamId: text("team_id"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at").notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("invitation_organizationId_idx").on(table.organizationId)],
);

// `relations()` was removed from drizzle-orm 1.0 in favour of the
// `defineRelations()` RQB v2 API. None of the exports above were
// consumed at runtime (better-auth talks to drizzle via plain selects),
// so the simplest migration is to delete them. If we ever need the
// RQB query builder we'll define them via defineRelations alongside
// the drizzle client.
