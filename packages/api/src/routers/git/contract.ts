/**
 * Git provider RPC contract.
 *
 * Surface:
 *   list           — providers + installations + repo counts for the active org
 *   startConnect   — returns the GitHub App install URL with a signed state
 *   disconnect     — soft-revokes an installation
 *   refreshRepos   — re-syncs the installation's repo list from GitHub
 *   listRepos      — accessible repos for an installation (DB-side, no API)
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  gitInstallationIdField,
  gitProviderIdField,
  gitRepoIdField,
} from "../project/contract/shared";

const tag = "git";
const basePath = "/git";

const gitProviderKindSchema = z.enum(["github"]);

const gitRepoViewSchema = z.object({
  id: gitRepoIdField,
  fullName: z.string(),
  defaultBranch: z.string(),
  isPrivate: z.boolean(),
  cloneUrl: z.string(),
});

export const gitInstallationViewSchema = z.object({
  id: gitInstallationIdField,
  providerId: gitProviderIdField,
  installationId: z.string(),
  accountLogin: z.string(),
  accountType: z.enum(["user", "organization"]),
  accountAvatarUrl: z.string().nullable(),
  repoSelection: z.enum(["all", "selected"]),
  suspendedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  createdAt: z.date(),
  repoCount: z.number().int().min(0),
});

export const gitProviderViewSchema = z.object({
  id: gitProviderIdField,
  kind: gitProviderKindSchema,
  displayName: z.string(),
  installations: z.array(gitInstallationViewSchema),
  createdAt: z.date(),
});

// GET input must be object/any/unknown for the OpenAPI generator; optional
// empty object keeps "no input" valid.
const listGitProvidersInput = z.object({}).optional();

/** Dashboard-relative path to send the operator back to after the GitHub
 *  round-trip (e.g. the deploy wizard they started from). The handler
 *  rejects anything that isn't a same-app path. */
const returnToField = z.string().max(512).optional();

const startConnectInput = z.object({
  kind: gitProviderKindSchema,
  returnTo: returnToField,
});

const startConnectOutput = z.object({
  /** Absolute URL the operator should be redirected to. */
  redirectUrl: z.string().url(),
});

const startManifestInput = z.object({
  /** Optional GitHub org login — when set, the manifest form POSTs to
   *  the org's app-creation URL so the operator doesn't have to switch
   *  account context on GitHub. */
  accountLogin: z.string().min(1).nullable().optional(),
  /** Optional override of the App's display name. Defaults to "Otterdeploy".
   *  GitHub App names are globally unique, so the UI pre-fills a random one. */
  appName: z.string().min(1).optional(),
  /** GitHub host to create the App on — omit for github.com, or a GHE
   *  hostname (e.g. "github.acme.com") for a self-hosted Enterprise instance. */
  host: z.string().min(1).optional(),
  returnTo: returnToField,
});

const startManifestOutput = z.object({
  /** Where the UI's auto-submitted form should POST. */
  formActionUrl: z.string().url(),
  /** JSON string — the value of the form's "manifest" field. */
  manifestJson: z.string(),
});

const disconnectInput = z.object({
  installationId: gitInstallationIdField,
});

const refreshReposInput = z.object({
  installationId: gitInstallationIdField,
});

const refreshReposOutput = z.object({
  repoCount: z.number().int().min(0),
});

const listInstallationReposInput = z.object({
  installationId: gitInstallationIdField,
});

const connectPublicRepoInput = z.object({
  // Any https:// clone URL — the handler validates + normalizes it.
  // SSH (`git@host:owner/repo.git`) is rejected: we'd need a per-org
  // deploy key to clone, which is its own credentials surface.
  cloneUrl: z.string().min(1),
});

const inspectRepoInput = z.object({
  gitRepoId: gitRepoIdField,
  /** Repo-relative path to list. Empty string = root. */
  path: z.string().default(""),
});

const listBranchesInput = z.object({
  gitRepoId: gitRepoIdField,
});

const listBranchesOutput = z.object({
  branches: z.array(z.string()),
  defaultBranch: z.string(),
});

const getRepoInput = z.object({
  gitRepoId: gitRepoIdField,
});

const getRepoOutput = z.object({
  fullName: z.string(),
  defaultBranch: z.string(),
});

const inspectEnvInput = z.object({
  gitRepoId: gitRepoIdField,
  path: z.string().default(""),
});

const inspectEnvOutput = z.object({
  /** Name of a committed real env file (.env, …), or null. Security flag. */
  committedEnv: z.string().nullable(),
  /** Template file the keys came from (.env.example, …), or null. */
  templateFile: z.string().nullable(),
  /** Variable names harvested from the template. */
  keys: z.array(z.string()),
});

const inspectEntrySchema = z.object({
  name: z.string(),
  type: z.enum(["dir", "file"]),
});

const frameworkKindSchema = z
  .enum([
    "next",
    "nuxt",
    "vite",
    "remix",
    "astro",
    "sveltekit",
    "react",
    "vue",
    "express",
    "fastify",
    "hono",
    "nest",
    "node",
    "bun",
    "go",
    "python",
    "rust",
    "ruby",
    "static",
  ])
  .nullable();

const monorepoKindSchema = z
  .enum(["turbo", "nx", "pnpm-workspace", "yarn-workspace", "npm-workspace", "lerna"])
  .nullable();

const inspectRepoOutput = z.object({
  fullName: z.string(),
  path: z.string(),
  entries: z.array(inspectEntrySchema),
  framework: frameworkKindSchema,
  monorepo: monorepoKindSchema,
  monorepoPackages: z.array(z.string()),
});

// ─── GitHub App detail page (get / permissions / resources / delete) ───

const getProviderInput = z.object({ providerId: gitProviderIdField });

const providerDetailSchema = z.object({
  id: gitProviderIdField,
  kind: gitProviderKindSchema,
  displayName: z.string(),
  host: z.string(),
  appSlug: z.string().nullable(),
  externalAppId: z.string().nullable(),
  createdAt: z.date(),
  /** Secrets are never returned — just whether each is present at rest. */
  secretsConfigured: z.object({
    clientSecret: z.boolean(),
    webhookSecret: z.boolean(),
    privateKey: z.boolean(),
  }),
  installation: gitInstallationViewSchema
    .extend({ permissions: z.record(z.string(), z.string()) })
    .nullable(),
});

const refetchPermissionsInput = z.object({ installationId: gitInstallationIdField });
const refetchPermissionsOutput = z.object({ permissions: z.record(z.string(), z.string()) });

const providerResourcesInput = z.object({ providerId: gitProviderIdField });
const providerResourceSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  projectSlug: z.string(),
  productionBranch: z.string().nullable(),
  repoFullName: z.string(),
});

const deleteProviderInput = z.object({ providerId: gitProviderIdField });

export const gitContract = {
  list: oc
    .meta({ path: `${basePath}/providers`, tag, method: "GET" })
    .input(listGitProvidersInput)
    .output(z.array(gitProviderViewSchema)),
  startConnect: oc
    .errors({
      NOT_CONFIGURED: {
        status: 503,
        message: "GitHub App is not configured on this instance" as const,
      },
    })
    .meta({ path: `${basePath}/connect/start`, tag, method: "POST" })
    .input(startConnectInput)
    .output(startConnectOutput),
  startManifest: oc
    .meta({ path: `${basePath}/connect/manifest`, tag, method: "POST" })
    .input(startManifestInput)
    .output(startManifestOutput),
  disconnect: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Installation not found" as const },
    })
    .meta({
      path: `${basePath}/installations/{installationId}`,
      tag,
      method: "DELETE",
    })
    .input(disconnectInput)
    .output(z.object({ ok: z.boolean() })),
  refreshRepos: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Installation not found" as const },
      NOT_CONFIGURED: {
        status: 503,
        message: "GitHub App is not configured on this instance" as const,
      },
      // GitHub no longer recognizes the installation — the client shows a
      // "Reinstall" action rather than a dead-end error.
      REINSTALL_REQUIRED: {
        status: 409,
        message: "This GitHub installation is no longer valid — reinstall the app" as const,
      },
    })
    .meta({
      path: `${basePath}/installations/{installationId}/refresh`,
      tag,
      method: "POST",
    })
    .input(refreshReposInput)
    .output(refreshReposOutput),
  getProvider: oc
    .errors({ NOT_FOUND: { status: 404, message: "Provider not found" as const } })
    .meta({ path: `${basePath}/providers/{providerId}`, tag, method: "GET" })
    .input(getProviderInput)
    .output(providerDetailSchema),
  refetchPermissions: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Installation not found" as const },
      NOT_CONFIGURED: {
        status: 503,
        message: "GitHub App is not configured on this instance" as const,
      },
      REINSTALL_REQUIRED: {
        status: 409,
        message: "This GitHub installation is no longer valid — reinstall the app" as const,
      },
    })
    .meta({
      path: `${basePath}/installations/{installationId}/permissions/refetch`,
      tag,
      method: "POST",
    })
    .input(refetchPermissionsInput)
    .output(refetchPermissionsOutput),
  resources: oc
    .meta({ path: `${basePath}/providers/{providerId}/resources`, tag, method: "GET" })
    .input(providerResourcesInput)
    .output(z.array(providerResourceSchema)),
  deleteProvider: oc
    .errors({ NOT_FOUND: { status: 404, message: "Provider not found" as const } })
    .meta({ path: `${basePath}/providers/{providerId}`, tag, method: "DELETE" })
    .input(deleteProviderInput)
    .output(z.object({ ok: z.boolean() })),
  listRepos: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Installation not found" as const },
    })
    .meta({
      path: `${basePath}/installations/{installationId}/repos`,
      tag,
      method: "GET",
    })
    .input(listInstallationReposInput)
    .output(z.array(gitRepoViewSchema)),
  // Register a public Git URL as a gitRepo row (no installation, no
  // webhook, no token mint). Project-level binding still flows through
  // project.update — this just makes the gitRepoId exist.
  connectPublicRepo: oc
    .errors({
      INVALID_URL: {
        status: 400,
        message: "Clone URL must be an https:// URL" as const,
      },
    })
    .meta({ path: `${basePath}/public-repos`, tag, method: "POST" })
    .input(connectPublicRepoInput)
    .output(gitRepoViewSchema),
  // Walk the bound repo's file tree + detect framework/monorepo signals
  // for the Root Directory picker in the new-resource wizard.
  inspectRepo: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Repo not found" as const },
      UPSTREAM: { status: 502, message: "Upstream error" as const },
      RATE_LIMITED: {
        status: 429,
        message: "GitHub rate-limited the inspection" as const,
      },
    })
    .meta({
      path: `${basePath}/repos/{gitRepoId}/inspect`,
      tag,
      method: "POST",
    })
    .input(inspectRepoInput)
    .output(inspectRepoOutput),
  // Branches of the bound repo, for the wizard's branch picker.
  listBranches: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Repo not found" as const },
      UPSTREAM: { status: 502, message: "Upstream error" as const },
      RATE_LIMITED: {
        status: 429,
        message: "GitHub rate-limited the branch listing" as const,
      },
    })
    .meta({
      path: `${basePath}/repos/{gitRepoId}/branches`,
      tag,
      method: "GET",
    })
    .input(listBranchesInput)
    .output(listBranchesOutput),
  // Bound repo's name/default branch straight from the DB — no GitHub call,
  // so the binding display never depends on (rate-limitable) inspect.
  getRepo: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Repo not found" as const },
    })
    .meta({
      path: `${basePath}/repos/{gitRepoId}`,
      tag,
      method: "GET",
    })
    .input(getRepoInput)
    .output(getRepoOutput),
  // Detect committed .env (security flag) + harvest keys from .env.example
  // for the new-resource wizard's Variables step.
  inspectEnv: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Repo not found" as const },
      UPSTREAM: { status: 502, message: "Upstream error" as const },
      RATE_LIMITED: {
        status: 429,
        message: "GitHub rate-limited the inspection" as const,
      },
    })
    .meta({
      path: `${basePath}/repos/{gitRepoId}/env`,
      tag,
      method: "GET",
    })
    .input(inspectEnvInput)
    .output(inspectEnvOutput),
};
