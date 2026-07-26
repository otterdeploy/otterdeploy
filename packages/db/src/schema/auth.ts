import type {
  AccountId,
  InvitationId,
  MemberId,
  OrganizationId,
  SessionId,
  VerificationId,
} from "@otterdeploy/shared/id";

import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const user = pgTable(
  "user",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId(ID_PREFIX.user)),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    // Installation authority is deliberately independent from organization
    // membership. The first bootstrap account receives this server-owned bit;
    // org owner/admin roles never imply it.
    isInstallAdmin: boolean("is_install_admin").default(false).notNull(),
    // better-auth `twoFactor` plugin: flipped true after the user verifies their
    // first TOTP code. The secret + backup codes live in the `two_factor` table.
    twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // Bootstrap is single-owner. Besides documenting the supported personal
    // installation model, this makes concurrent first-signup races fail closed.
    uniqueIndex("user_single_install_admin_idx")
      .on(table.isInstallAdmin)
      .where(sql`${table.isInstallAdmin} = true`),
  ],
);

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

// better-auth `twoFactor` plugin store. One row per user with 2FA configured:
// the TOTP `secret` (encrypted at rest with BETTER_AUTH_SECRET) and the
// single-use `backupCodes` (encrypted). The plugin owns every column — property
// keys stay camelCase to match its model field names. Like `device_code`, the
// id is minted by better-auth's `generateId`, so no `$defaultFn` here.
export const twoFactor = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // better-auth ≥1.6 writes this on enable (false until the first TOTP code
    // is confirmed; sign-in only offers "totp" when `verified !== false`).
    // Missing it made /two-factor/enable 500 with "The field \"verified\" does
    // not exist in the \"twoFactor\" Drizzle schema". Default true matches the
    // plugin's own schema (pre-existing rows are treated as verified).
    verified: boolean("verified").default(true),
  },
  (table) => [index("two_factor_userId_idx").on(table.userId)],
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
    // Required by better-auth's organization plugin (its invitation model writes
    // `createdAt` on create). Missing it made every invite 500 with "The field
    // createdAt does not exist in the invitation Drizzle schema".
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("invitation_organizationId_idx").on(table.organizationId)],
);

// API keys (better-auth `apiKey` plugin, configured with
// `references: "organization"` in packages/auth/src/index.ts — so `referenceId`
// holds an organization id, not a user id). The plugin owns every column here;
// property keys MUST stay camelCase to match the plugin's model field names
// (the drizzle adapter maps field name → table property), while DB columns are
// snake_case to match the rest of the schema. `key` is the hashed token; the
// plaintext value is returned only once at creation time and never stored.
export const apikey = pgTable(
  "apikey",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId(ID_PREFIX.apiKey)),
    // The configuration this key belongs to (the plugin's `configId`). Plain
    // text, set by the plugin; not a foreign key — configs live in code.
    configId: text("config_id").notNull(),
    name: text("name"),
    // First few characters of the key (incl. prefix) for display in the UI.
    start: text("start"),
    prefix: text("prefix"),
    // Organization id that owns the key (because `references: "organization"`).
    referenceId: text("reference_id").notNull(),
    // Hashed key value — never the plaintext.
    key: text("key").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at"),
    enabled: boolean("enabled").default(true).notNull(),
    rateLimitEnabled: boolean("rate_limit_enabled").default(true).notNull(),
    rateLimitTimeWindow: integer("rate_limit_time_window"),
    rateLimitMax: integer("rate_limit_max"),
    requestCount: integer("request_count").default(0).notNull(),
    remaining: integer("remaining"),
    lastRequest: timestamp("last_request"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    // JSON-encoded permissions ({ resource: actions[] }) and arbitrary metadata.
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("apikey_referenceId_idx").on(table.referenceId),
    index("apikey_key_idx").on(table.key),
  ],
);

// better-auth `sso` plugin store (@better-auth/sso). One row per registered
// identity provider. Like `device_code` and `apikey` above, the plugin owns
// every column — property keys MUST stay camelCase to match its model field
// names (the drizzle adapter maps field name → table property) while DB columns
// stay snake_case with the rest of the schema.
//
// `oidcConfig` is the plugin's own JSON blob, stored as text because that is the
// type the plugin declares (`type: "string"`). It CONTAINS THE CLIENT SECRET —
// never select this column into anything user-facing. The UI never needs to:
// the plugin's own `/sso/providers` endpoint already projects a redacted view
// (`clientIdLastFour`, endpoints, scopes — no secret, no full client id), which
// is why the settings page reads through `authClient.sso.*` rather than a
// hand-rolled query over this table.
//
// `samlConfig` is declared by the plugin's schema even though this install is
// OIDC-only (see the `sso()` registration in packages/auth/src/index.ts). The
// column has to exist or the adapter's insert/select field map breaks; it simply
// stays null until SAML is enabled.
export const ssoProvider = pgTable(
  "sso_provider",
  {
    // Minted by better-auth's `generateId`, like `device_code` and `two_factor`
    // — so no `$defaultFn` here.
    id: text("id").primaryKey(),
    // The IdP's issuer URL. Doubles as a login hint: `signIn.sso({ issuer })`
    // resolves a provider by this value when no email domain is supplied.
    issuer: text("issuer").notNull(),
    oidcConfig: text("oidc_config"),
    samlConfig: text("saml_config"),
    // Who registered it. Nullable rather than cascading: deleting the admin who
    // set up SSO must not silently take the whole workspace's login with them.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    // Stable public handle for the provider, used in callback URLs
    // (`/sso/callback/:providerId`). Unique across the install.
    providerId: text("provider_id").notNull().unique(),
    // The workspace this provider signs users into. Null would mean an
    // install-wide provider; every provider registered through our UI is
    // org-scoped, which is what makes per-workspace SSO possible.
    organizationId: text("organization_id").$type<OrganizationId>(),
    // Email domain that routes to this provider ("acme.com"). Stored lowercase
    // — see `normalizeDomain` in packages/api/src/routers/sso/queries.ts; the
    // sign-in lookup compares against an already-lowercased address, so a
    // mixed-case row here would simply never match.
    domain: text("domain").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // The sign-in path is "given an email domain, find the provider" — the one
    // lookup that happens before every SSO login.
    index("sso_provider_domain_idx").on(table.domain),
    index("sso_provider_organization_id_idx").on(table.organizationId),
  ],
);

// `relations()` was removed from drizzle-orm 1.0 in favour of the
// `defineRelations()` RQB v2 API. None of the exports above were
// consumed at runtime (better-auth talks to drizzle via plain selects),
// so the simplest migration is to delete them. If we ever need the
// RQB query builder we'll define them via defineRelations alongside
// the drizzle client.
