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

import { ID_PREFIX, zId } from "@otterstack/shared/id";

const tag = "git";
const basePath = "/git";

export const gitProviderKindSchema = z.enum(["github"]);

export const gitRepoViewSchema = z.object({
  id: zId(ID_PREFIX.gitRepo),
  fullName: z.string(),
  defaultBranch: z.string(),
  isPrivate: z.boolean(),
  cloneUrl: z.string(),
});

export const gitInstallationViewSchema = z.object({
  id: zId(ID_PREFIX.gitInstallation),
  providerId: zId(ID_PREFIX.gitProvider),
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
  id: zId(ID_PREFIX.gitProvider),
  kind: gitProviderKindSchema,
  displayName: z.string(),
  installations: z.array(gitInstallationViewSchema),
  createdAt: z.date(),
});

export const listGitProvidersInput = z.void();

export const startConnectInput = z.object({
  kind: gitProviderKindSchema,
});

export const startConnectOutput = z.object({
  /** Absolute URL the operator should be redirected to. */
  redirectUrl: z.string().url(),
});

export const disconnectInput = z.object({
  installationId: zId(ID_PREFIX.gitInstallation),
});

export const refreshReposInput = z.object({
  installationId: zId(ID_PREFIX.gitInstallation),
});

export const refreshReposOutput = z.object({
  repoCount: z.number().int().min(0),
});

export const listInstallationReposInput = z.object({
  installationId: zId(ID_PREFIX.gitInstallation),
});

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
  disconnect: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Installation not found" as const },
    })
    .meta({ path: `${basePath}/installations/{installationId}`, tag, method: "DELETE" })
    .input(disconnectInput)
    .output(z.object({ ok: z.boolean() })),
  refreshRepos: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Installation not found" as const },
      NOT_CONFIGURED: {
        status: 503,
        message: "GitHub App is not configured on this instance" as const,
      },
    })
    .meta({ path: `${basePath}/installations/{installationId}/refresh`, tag, method: "POST" })
    .input(refreshReposInput)
    .output(refreshReposOutput),
  listRepos: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Installation not found" as const },
    })
    .meta({ path: `${basePath}/installations/{installationId}/repos`, tag, method: "GET" })
    .input(listInstallationReposInput)
    .output(z.array(gitRepoViewSchema)),
};
