/**
 * The GHCR capability decision and the stored-token guard.
 *
 * Both are pure by design: the database-facing wrapper is a pair of selects
 * with no branching left in it, and this is where the branching lives.
 */

import { describe, expect, it } from "vite-plus/test";

import {
  GHCR_TOKEN_USERNAME,
  decideGhcrCapability,
  installationPermissionUrl,
  looksLikeInstallationToken,
  shouldDeriveGhcr,
} from "../ghcr-policy";

const installation = {
  installationId: "12345678",
  accountLogin: "acme",
  accountType: "Organization",
  permissions: { contents: "read", packages: "write" },
};

describe("decideGhcrCapability", () => {
  it("reports ok for an installation that was granted packages", () => {
    expect(decideGhcrCapability({ installation, hasProvider: true })).toEqual({
      available: true,
      installationId: "12345678",
      accountLogin: "acme",
      accountType: "Organization",
      reason: "ok",
    });
  });

  it("accepts read-only packages: pulling is the common case", () => {
    const readOnly = { ...installation, permissions: { packages: "read" } };
    expect(decideGhcrCapability({ installation: readOnly, hasProvider: true }).reason).toBe("ok");
  });

  it("separates 'no App at all' from 'App connected but not installed'", () => {
    expect(decideGhcrCapability({ installation: null, hasProvider: false }).reason).toBe("no-app");
    expect(decideGhcrCapability({ installation: null, hasProvider: true }).reason).toBe(
      "no-installation",
    );
  });

  it("reports a missing packages grant", () => {
    const noPackages = { ...installation, permissions: { contents: "read" } };
    expect(decideGhcrCapability({ installation: noPackages, hasProvider: true }).reason).toBe(
      "missing-packages-permission",
    );
  });

  // The load-bearing one. The permissions snapshot is documented as
  // diagnostics-only and goes stale the moment the App's requested permissions
  // change, because GitHub makes every existing installation re-authorize
  // before the new grant appears. Gating availability on it would dark-launch
  // the feature for every org that installed the App before this shipped.
  it("stays AVAILABLE when the snapshot lacks packages, so GitHub stays the authority", () => {
    const noPackages = { ...installation, permissions: {} };
    const decision = decideGhcrCapability({ installation: noPackages, hasProvider: true });
    expect(decision.available).toBe(true);
    expect(decision.installationId).toBe("12345678");
    expect(decision.reason).toBe("missing-packages-permission");
  });

  it("never reports an installation id when unavailable", () => {
    for (const hasProvider of [true, false]) {
      const decision = decideGhcrCapability({ installation: null, hasProvider });
      expect(decision.available).toBe(false);
      expect(decision.installationId).toBeNull();
    }
  });
});

describe("looksLikeInstallationToken", () => {
  // Storing one of these is the single most likely way to get this feature
  // wrong: it authenticates during testing and stops about an hour later, with
  // the failure surfacing at deploy time far from where it was typed.
  it("catches an installation access token", () => {
    expect(looksLikeInstallationToken("ghs_16C7e42F292c6912E7710c838347Ae178B4a")).toBe(true);
    expect(looksLikeInstallationToken("  ghs_padded  ")).toBe(true);
  });

  it("leaves the credentials people are meant to store alone", () => {
    for (const secret of [
      "ghp_16C7e42F292c6912E7710c838347Ae178B4a", // classic PAT
      "github_pat_11ABCDE0Y", // fine-grained PAT
      "dckr_pat_abc", // Docker Hub
      "hunter2",
      "",
    ]) {
      expect(looksLikeInstallationToken(secret)).toBe(false);
    }
  });
});

describe("the GHCR login name", () => {
  // GHCR requires this literal when the password is a token. The
  // container_registry.username column already documents the case.
  it("is x-access-token", () => {
    expect(GHCR_TOKEN_USERNAME).toBe("x-access-token");
  });
});

describe("shouldDeriveGhcr", () => {
  it("derives for GHCR when nothing is stored", () => {
    expect(shouldDeriveGhcr({ host: "ghcr.io", storedCredentialCount: 0 })).toBe(true);
  });

  // An operator who typed a ghcr.io credential meant it — quite possibly a bot
  // account that can see packages the App installation cannot. Silently
  // preferring a derived token over their explicit choice would be very hard
  // to diagnose from a deploy log.
  it("yields to a stored credential the operator entered", () => {
    expect(shouldDeriveGhcr({ host: "ghcr.io", storedCredentialCount: 1 })).toBe(false);
  });

  it("never touches another registry: no GitHub credential works there", () => {
    for (const host of ["docker.io", "registry:5000", "quay.io", "localhost:5000"]) {
      expect(shouldDeriveGhcr({ host, storedCredentialCount: 0 })).toBe(false);
    }
  });
});

describe("installationPermissionUrl", () => {
  const base = { available: true, installationId: "42", accountLogin: "acme" } as const;

  it("points an organization install at its org settings", () => {
    expect(
      installationPermissionUrl({
        ...base,
        accountType: "Organization",
        reason: "missing-packages-permission",
      }),
    ).toBe("https://github.com/organizations/acme/settings/installations/42/permissions/update");
  });

  it("points a personal install at personal settings", () => {
    expect(
      installationPermissionUrl({
        ...base,
        accountType: "User",
        reason: "missing-packages-permission",
      }),
    ).toBe("https://github.com/settings/installations/42/permissions/update");
  });

  // One thing for the UI to check rather than two.
  it("is null when there is nothing to approve", () => {
    for (const reason of ["ok", "no-app", "no-installation"] as const) {
      expect(installationPermissionUrl({ ...base, accountType: "User", reason })).toBeNull();
    }
  });

  it("is null without an installation to link to", () => {
    expect(
      installationPermissionUrl({
        available: false,
        installationId: null,
        accountLogin: null,
        accountType: null,
        reason: "missing-packages-permission",
      }),
    ).toBeNull();
  });
});
