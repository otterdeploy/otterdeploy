import type { GitInstallationId, GitProviderId, GitRepoId } from "@otterdeploy/shared/id";

// Git source connections — providers (GitHub App, GitLab, …), per-org
// installations of those providers, and the repos those installations expose
// for deploys. Webhook deliveries land against `gitInstallation.installationId`
// and matching `gitRepo` rows; a push event for a repo whose row is linked
// to a project (via `project.gitRepoId`) triggers a deploy.
//
// GitHub Apps are created through the manifest flow (the operator clicks
// "Create GitHub App" in the UI; GitHub posts the app's credentials back to
// our callback, which persists them on the gitProvider row). No env-var
// configuration of GitHub credentials — every credential field below is
// nullable so the provider row can also exist for the legacy env-var path
// during the transition, but new providers always populate them.
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";

export const gitProviderKindEnum = pgEnum("git_provider_kind", ["github"]);

/**
 * One row per (org, provider kind) — the org's choice to allow that provider
 * for source connections. Holds the org-visible display name and (for
 * GitHub Apps created via the manifest flow) the App's credentials. Secret
 * fields are AES-GCM ciphertext, encoded as `iv:tag:ciphertext` base64
 * triples; the key is derived from BETTER_AUTH_SECRET so creds never sit
 * on disk in plaintext.
 *
 * Nullable because the row exists before the manifest callback fires —
 * the row's keyed by (organizationId, kind) and the manifest flow
 * upserts it with credentials populated. A row with `externalAppId =
 * null` is "App being created"; queries that mint JWTs treat that as
 * `GithubAppNotConfiguredError`.
 */
export const gitProvider = pgTable(
  "git_provider",
  {
    id: text("id")
      .primaryKey()
      .$type<GitProviderId>()
      .$defaultFn(() => createId(ID_PREFIX.gitProvider)),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: gitProviderKindEnum("kind").notNull(),
    displayName: text("display_name").notNull(),

    // Host this App lives on. Defaults to github.com; future GitHub
    // Enterprise installs override this. Drives API + clone URLs.
    host: text("host").notNull().default("github.com"),

    // GitHub-side identity. App ID is numeric but stored as text to match
    // GitHub's API responses (which serialize as strings). Slug drives the
    // `https://github.com/apps/<slug>/installations/new` install URL.
    externalAppId: text("external_app_id"),
    appSlug: text("app_slug"),

    // OAuth-on-behalf-of-app pair. clientSecret is encrypted at rest.
    clientId: text("client_id"),
    clientSecretCiphertext: text("client_secret_ciphertext"),

    // Webhook signing secret — used by webhook-handler to verify deliveries.
    webhookSecretCiphertext: text("webhook_secret_ciphertext"),

    // PEM-encoded RSA private key. Used to mint installation tokens.
    privateKeyPemCiphertext: text("private_key_pem_ciphertext"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("git_provider_org_kind_unique").on(table.organizationId, table.kind),
    index("git_provider_organization_id_idx").on(table.organizationId),
    // Webhook deliveries identify their App via X-GitHub-Hook-Installation-
    // Target-ID. Index so the receiver routes in O(log n).
    index("git_provider_external_app_id_idx").on(table.externalAppId),
  ],
);

export const gitInstallationAccountTypeEnum = pgEnum("git_installation_account_type", [
  "user",
  "organization",
]);
export const gitInstallationRepoSelectionEnum = pgEnum("git_installation_repo_selection", [
  "all",
  "selected",
]);

/**
 * A specific install of the GitHub App into a user/org account. `installationId`
 * is the GitHub-side numeric id used to mint short-lived installation access
 * tokens. We don't store the access tokens — they're minted on demand using
 * the App's private key (looked up via the parent `gitProvider` row).
 */
export const gitInstallation = pgTable(
  "git_installation",
  {
    id: text("id")
      .primaryKey()
      .$type<GitInstallationId>()
      .$defaultFn(() => createId(ID_PREFIX.gitInstallation)),
    providerId: text("provider_id")
      .notNull()
      .$type<GitProviderId>()
      .references(() => gitProvider.id, { onDelete: "cascade" }),
    /** GitHub installation id (from the App install callback / webhook). */
    installationId: text("installation_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: gitInstallationAccountTypeEnum("account_type").notNull(),
    accountAvatarUrl: text("account_avatar_url"),
    repoSelection: gitInstallationRepoSelectionEnum("repo_selection").notNull(),
    /** Permissions the install was granted, as returned by GitHub. Kept for
     *  diagnostics — we never re-grant based on this snapshot. */
    permissions: jsonb("permissions").$type<Record<string, string>>().notNull().default({}),
    /**
     * Repository count as GitHub last reported it — `total_count` from
     * `GET /installation/repositories`, written on every full sync (install
     * callback + "Sync now") and delta-adjusted by `installation_repositories`
     * webhooks. Null = never successfully fetched (or the install was
     * revoked), so the UI can show "—" instead of a confident-but-wrong 0.
     * Deliberately NOT derived from `git_repo` rows: those are our local
     * mirror, which is empty until the first successful sync.
     */
    repoCount: integer("repo_count"),
    suspendedAt: timestamp("suspended_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("git_installation_installation_id_unique").on(table.installationId),
    index("git_installation_provider_id_idx").on(table.providerId),
  ],
);

/**
 * A repo the installation grants us access to. Synced from
 * `installation_repositories` webhooks and on-demand list calls. A repo can
 * disappear (selection narrowed, install revoked) — we soft-delete by
 * clearing `installationId` rather than dropping the row, so historical
 * deployments still resolve their source.
 */
export const gitRepo = pgTable(
  "git_repo",
  {
    id: text("id")
      .primaryKey()
      .$type<GitRepoId>()
      .$defaultFn(() => createId(ID_PREFIX.gitRepo)),
    installationId: text("installation_id")
      .$type<GitInstallationId>()
      .references(() => gitInstallation.id, { onDelete: "set null" }),
    /** GitHub repo node id (stable across renames) stored as text. */
    providerRepoId: text("provider_repo_id").notNull(),
    fullName: text("full_name").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    isPrivate: boolean("is_private").notNull().default(true),
    cloneUrl: text("clone_url").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("git_repo_provider_repo_id_unique").on(table.providerRepoId),
    index("git_repo_installation_id_idx").on(table.installationId),
    index("git_repo_full_name_idx").on(table.fullName),
  ],
);
