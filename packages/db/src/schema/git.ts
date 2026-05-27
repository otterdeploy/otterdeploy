// Git source connections — providers (GitHub App, GitLab, …), per-org
// installations of those providers, and the repos those installations expose
// for deploys. Webhook deliveries land against `gitInstallation.installationId`
// and matching `gitRepo` rows; a push event for a repo whose row is linked
// to a project (via `project.gitRepoId`) triggers a deploy.
//
// Phase 1 only models GitHub App installations. Provider rows exist so the
// later GitLab / Bitbucket additions land as a new `kind` without a schema
// migration.

import { createId, ID_PREFIX, type Id } from "@otterstack/shared/id";
import {
  boolean,
  index,
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
 * for source connections. Holds the org-visible display name. App-level
 * credentials (App ID, private key, webhook secret) live in env, not here.
 */
export const gitProvider = pgTable(
  "git_provider",
  {
    id: text("id")
      .primaryKey()
      .$type<Id<typeof ID_PREFIX.gitProvider>>()
      .$defaultFn(() => createId(ID_PREFIX.gitProvider)),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: gitProviderKindEnum("kind").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("git_provider_org_kind_unique").on(table.organizationId, table.kind),
    index("git_provider_organization_id_idx").on(table.organizationId),
  ],
);

export const gitInstallationAccountTypeEnum = pgEnum(
  "git_installation_account_type",
  ["user", "organization"],
);
export const gitInstallationRepoSelectionEnum = pgEnum(
  "git_installation_repo_selection",
  ["all", "selected"],
);

/**
 * A specific install of the GitHub App into a user/org account. `installationId`
 * is the GitHub-side numeric id used to mint short-lived installation access
 * tokens. We don't store the access tokens — they're minted on demand using
 * the App's private key (env).
 */
export const gitInstallation = pgTable(
  "git_installation",
  {
    id: text("id")
      .primaryKey()
      .$type<Id<typeof ID_PREFIX.gitInstallation>>()
      .$defaultFn(() => createId(ID_PREFIX.gitInstallation)),
    providerId: text("provider_id")
      .notNull()
      .$type<Id<typeof ID_PREFIX.gitProvider>>()
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
      .$type<Id<typeof ID_PREFIX.gitRepo>>()
      .$defaultFn(() => createId(ID_PREFIX.gitRepo)),
    installationId: text("installation_id")
      .$type<Id<typeof ID_PREFIX.gitInstallation>>()
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
