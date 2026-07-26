/**
 * od-5j8.2 — central capability authorization across every transport.
 *
 * Invariant under test:
 *   1. An unauthenticated caller is rejected by the capability boundary
 *      regardless of which capability it asks for.
 *   2. An under-privileged caller (wrong org, read-only key attempting a
 *      write, key missing the permission, key scoped to a different project,
 *      an org API key never gains install authority) is rejected.
 *   3. Every non-oRPC transport that performs privileged work (the raw HTTP
 *      upload route, the WebSocket PTY upgrade) delegates its decision to the
 *      SAME `authorizeCapability` function oRPC procedures use — not a
 *      hand-rolled parallel check that can drift out of sync.
 *   4. Structurally, no router file builds a procedure directly off
 *      `publicProcedure` — every handler in `packages/api/src/routers/**`
 *      is reachable only through a procedure builder that requires at least
 *      authentication (`protectedProcedure`/`orgScopedProcedure`/
 *      `projectScopedProcedure`/`requirePermission`/`requireInstallAdmin`/
 *      `requireInstallAdminPermission`). A procedure that "forgets" to
 *      declare a capability therefore still fails closed at the
 *      authentication gate, never open to the public internet.
 */
import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";

import type { ApiKeyActor, SessionActor } from "../../authz/actor";
import type { Capability } from "../../authz/capability";

// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.DATABASE_URL ??= "postgres://test/test";
// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.REDIS_URL ??= "redis://localhost:6379";
// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.CORS_ORIGIN ??= "http://localhost:3000";
// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.RESEND_API_KEY ??= "test-resend-key";

const { authorizeCapability } = await import("../../authz/capability");
const { authorizeRoleScope } = await import("../../authz/api-key-scope");

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");
const routersDir = resolve(repositoryRoot, "packages/api/src/routers");

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const full = resolve(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) return walk(full);
    return full.endsWith(".ts") && !full.includes("__tests__") ? [full] : [];
  });
}

// ---------------------------------------------------------------------------
// Matrix fixtures
// ---------------------------------------------------------------------------

const readCapability: Capability = {
  scope: "organization",
  mode: "read",
  organizationId: "org_1",
  permission: { service: ["read"] },
};

const writeCapability: Capability = {
  scope: "organization",
  mode: "write",
  organizationId: "org_1",
  projectId: "project_1",
  permission: { service: ["deploy"] },
};

const sessionActor: SessionActor = {
  kind: "session",
  headers: new Headers(),
  user: {
    id: "user_1",
    email: "operator@example.test",
    isInstallAdmin: false,
    twoFactorEnabled: true,
  },
  session: { activeOrganizationId: "org_1" },
};

function apiKey(overrides: Partial<ApiKeyActor> = {}): ApiKeyActor {
  return {
    kind: "api-key",
    id: "key_1",
    organizationId: "org_1",
    permissions: { service: ["deploy"] },
    accessLevel: "write",
    projectScope: "all",
    ...overrides,
  };
}

describe("[od-5j8.2] unauthenticated callers are rejected for every capability shape", () => {
  test.each<[string, Capability]>([
    ["organization read", readCapability],
    ["organization write", writeCapability],
    ["install read", { scope: "install", mode: "read" }],
    ["install write", { scope: "install", mode: "write" }],
  ])("null actor ⇒ 401 for %s", async (_label, capability) => {
    const decision = await authorizeCapability(null, capability);
    expect(decision).toEqual({
      allowed: false,
      status: 401,
      reason: "Authentication is required.",
    });
  });
});

describe("[od-5j8.2] under-privileged callers are rejected", () => {
  test("a key from a different organization is denied before any permission check", async () => {
    const decision = await authorizeCapability(apiKey({ organizationId: "org_evil" }), writeCapability);
    expect(decision.allowed).toBe(false);
  });

  test("a read-only key cannot perform a write, even holding the exact permission", async () => {
    const decision = await authorizeCapability(apiKey({ accessLevel: "read" }), writeCapability);
    expect(decision).toMatchObject({ allowed: false, reason: "This API key is read-only." });
  });

  test("a key missing the required permission is denied", async () => {
    const decision = await authorizeCapability(
      apiKey({ permissions: { service: ["read"] } }),
      writeCapability,
    );
    expect(decision.allowed).toBe(false);
  });

  test("a key scoped to a different project is denied even with the right org + permission", async () => {
    const decision = await authorizeCapability(
      apiKey({ projectScope: "selected", projectIds: ["project_other"] }),
      writeCapability,
    );
    expect(decision).toMatchObject({ allowed: false, reason: "This API key is not scoped to that project." });
  });

  test("a session whose live permission check fails is denied even for a read", async () => {
    const decision = await authorizeCapability(sessionActor, readCapability, {
      hasSessionPermission: async () => false,
    });
    expect(decision.allowed).toBe(false);
  });

  test("session in the wrong active organization is denied", async () => {
    const wrongOrgSession: SessionActor = {
      ...sessionActor,
      session: { activeOrganizationId: "org_other" },
    };
    const decision = await authorizeCapability(wrongOrgSession, writeCapability);
    expect(decision.allowed).toBe(false);
  });

  test("an API key can never claim install authority regardless of its permission map", async () => {
    const decision = await authorizeCapability(apiKey({ permissions: null }), {
      scope: "install",
      mode: "write",
    });
    expect(decision.allowed).toBe(false);
  });

  test("a malformed capability (missing organizationId) still fails closed rather than defaulting to allow", async () => {
    // @ts-expect-error — hostile input: a capability object missing the
    // required `organizationId` must not be treated as an implicit allow.
    // (An organization-scope capability with no id can never equal the
    // actor's own org id, so this must resolve to an explicit deny.)
    const decision = await authorizeCapability(sessionActor, {
      scope: "organization",
      mode: "read",
      permission: { service: ["read"] },
    });
    expect(decision.allowed).toBe(false);
  });
});

describe("[od-5j8.2] every API key is capped at the least-privileged org role", () => {
  test("a key minted with an owner-only permission map (member:delete) is still denied", () => {
    // authorizeKeyScope alone would allow this (the key's own map grants it);
    // authorizeRoleScope is the second, independent gate that caps every key
    // at `member` regardless of what the key's stored permission map claims.
    expect(authorizeRoleScope({ member: ["delete"] } as never)).toBe(false);
  });

  test("a key requesting an ordinary member-level action is allowed by the role cap", () => {
    expect(authorizeRoleScope({ service: ["deploy"] } as never)).toBe(true);
  });
});

describe("[od-5j8.2] non-oRPC transports delegate to the same capability boundary", () => {
  const transportSources = {
    orpc: "packages/api/src/index.ts",
    rawUpload: "apps/server/src/handlers/upload/source.ts",
    // od-5j8.9: the WebSocket PTY upgrade itself no longer authorizes
    // anything — target authorization now happens once, at ticket-mint time,
    // through the ordinary `terminal.mintTicket` oRPC procedure. See
    // packages/api/src/__tests__/security/od-5j8.9-terminal-ticket-origin.test.ts
    // for the WS-transport invariants (Origin check, ticket consumption, no
    // authorizeCapability/resolveRequestActor left in that file at all).
    terminalTicketAuthz: "packages/api/src/routers/terminal/authorize.ts",
  } as const;

  for (const [transport, path] of Object.entries(transportSources)) {
    test(`${transport} calls authorizeCapability(...) rather than re-implementing the decision`, () => {
      expect(readSource(resolve(repositoryRoot, path))).toContain("authorizeCapability(");
    });
  }

  test("the raw upload route resolves its actor via the shared resolver, not a hand-rolled session/key check", () => {
    const text = readSource(resolve(repositoryRoot, transportSources.rawUpload));
    expect(text).toContain("resolveRequestActor(");
    expect(text).not.toContain("auth.api.getSession");
    expect(text).not.toContain("auth.api.verifyApiKey");
  });

  test("the terminal ticket authorizer denies before any ticket is minted (401/403/404, not a post-hoc close)", () => {
    const text = readSource(resolve(repositoryRoot, transportSources.terminalTicketAuthz));
    // The host-shell branch requires install scope; every branch fails
    // closed with an explicit status, never an implicit allow.
    expect(text).toContain('scope: "install"');
    expect(text).toMatch(/status:\s*401/);
    expect(text).toMatch(/status:\s*403|decision\.status/);
  });
});

describe("[od-5j8.2] a procedure with no declared capability still fails closed (structural)", () => {
  test("no router file constructs a procedure directly off publicProcedure", () => {
    const offenders: string[] = [];
    for (const file of walk(routersDir)) {
      const text = readSource(file);
      if (/\bpublicProcedure\b/.test(text)) offenders.push(file);
    }
    // publicProcedure is the unauthenticated base — it exists only to build
    // protectedProcedure/orgScopedProcedure in index.ts. A router that
    // references it directly would define an endpoint reachable with no
    // authentication at all, silently bypassing every capability check below.
    expect(offenders).toEqual([]);
  });

  test("index.ts exports exactly the guarded procedure builders routers are allowed to use", () => {
    const text = readSource(resolve(repositoryRoot, "packages/api/src/index.ts"));
    for (const exportedBuilder of [
      "export const protectedProcedure",
      "export const orgScopedProcedure",
      "export const projectScopedProcedure",
      "export function requirePermission",
      "export function requireInstallAdmin",
      "export function requireInstallAdminPermission",
    ]) {
      expect(text).toContain(exportedBuilder);
    }
  });

  test("the install-admin middleware itself fails closed on a false/undefined isInstallAdmin flag", async () => {
    const nonAdmin: SessionActor = {
      ...sessionActor,
      user: { ...sessionActor.user, isInstallAdmin: false },
    };
    const decision = await authorizeCapability(nonAdmin, { scope: "install", mode: "read" });
    expect(decision.allowed).toBe(false);
  });
});
