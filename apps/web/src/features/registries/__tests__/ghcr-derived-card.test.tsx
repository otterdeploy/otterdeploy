/**
 * When the derived GHCR entry is drawn.
 *
 * The predicate is the whole thing worth pinning: drawing it alongside a
 * stored ghcr.io credential would state two different answers to "what
 * authenticates my pushes", and the server resolves that the other way (a
 * stored row wins — see `shouldDeriveGhcr`).
 */

import { describe, expect, it } from "vite-plus/test";

import { type GhcrCapabilityView, shouldShowDerivedGhcr } from "../ghcr-derived-card";

const covered: GhcrCapabilityView = {
  available: true,
  reason: "ok",
  accountLogin: "acme",
  storedCredentialExists: false,
  permissionUrl: null,
};

describe("shouldShowDerivedGhcr", () => {
  it("shows it when the App covers GHCR and nothing is stored", () => {
    expect(shouldShowDerivedGhcr(covered)).toBe(true);
  });

  // The server prefers the stored row, so the UI must not claim otherwise.
  it("yields to a stored ghcr.io credential", () => {
    expect(shouldShowDerivedGhcr({ ...covered, storedCredentialExists: true })).toBe(false);
  });

  it("stays hidden without a usable installation", () => {
    for (const reason of ["no-app", "no-installation"] as const) {
      expect(shouldShowDerivedGhcr({ ...covered, available: false, reason })).toBe(false);
    }
  });

  // Availability, not the permission snapshot, is the gate — the snapshot goes
  // stale until every installation re-authorizes, so a missing grant still
  // shows the entry, with the prompt to approve it.
  it("still shows it when only the packages grant is missing", () => {
    expect(
      shouldShowDerivedGhcr({
        ...covered,
        reason: "missing-packages-permission",
        permissionUrl: "https://github.com/settings/installations/42/permissions/update",
      }),
    ).toBe(true);
  });

  it("draws nothing while the capability is still loading", () => {
    expect(shouldShowDerivedGhcr(undefined)).toBe(false);
  });
});
