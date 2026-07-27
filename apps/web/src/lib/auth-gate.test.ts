import { describe, expect, it } from "vite-plus/test";

import { decideAuthGate } from "./auth-gate";

const session = { user: { id: "user_1" }, session: { activeOrganizationId: "org_1" } };
const orgs = [{ id: "org_1", name: "Acme", slug: "acme", createdAt: "2026-01-01" }] as never;

describe("decideAuthGate", () => {
  it("allows a signed-in user who has a workspace", () => {
    expect(decideAuthGate({ session, organizations: orgs })).toEqual({
      kind: "allow",
      organizations: orgs,
    });
  });

  it("sends a signed-in user with no workspaces to onboarding", () => {
    expect(decideAuthGate({ session, organizations: [] })).toEqual({ kind: "onboarding" });
  });

  it("sends a resolved-but-absent session to sign-in", () => {
    expect(decideAuthGate({ session: null, organizations: [] })).toEqual({ kind: "sign-in" });
  });

  it("sends a 401 org read to sign-in, NOT to a crash", () => {
    // The regression this file exists for. A signed-out visitor's org read
    // answers 401; `organizationsQuery` resolves that to null instead of
    // throwing, because a throw rejected the gate's concurrent Promise.all and
    // produced a 500 screen before the sign-in redirect could run.
    expect(decideAuthGate({ session: null, organizations: null })).toEqual({ kind: "sign-in" });
  });

  it("prefers sign-in over onboarding when the session is cached but the cookie died", () => {
    // sessionQuery has a 5-minute staleTime, so a cookie expiring mid-window
    // leaves a CACHED session next to a LIVE 401. Reading that as "no orgs"
    // would drop a signed-out visitor into workspace creation.
    expect(decideAuthGate({ session, organizations: null })).toEqual({ kind: "sign-in" });
  });
});
