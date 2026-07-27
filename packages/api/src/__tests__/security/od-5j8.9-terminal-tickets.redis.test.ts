/**
 * od-5j8.9 — terminal access redesign: single-use tickets + step-up + Origin
 * checks on the /pty WebSocket upgrade.
 *
 * Invariants under test:
 *   1. A ticket is single-use — consuming it a second time (a replay) fails.
 *   2. A ticket minted for target A resolves to target A, never target B — and
 *      structurally, the WS upgrade (apps/server/src/handlers/terminal/ws.ts)
 *      accepts NO client-supplied target at all (no `?container=`/`?host=1`),
 *      so there is nothing left for a client to substitute.
 *   3. An expired ticket fails, exactly like a replay (Redis TTL eviction).
 *   4. The host terminal — the most dangerous target — is install-admin only;
 *      an ordinary organization member (even with the terminal:open
 *      permission) is denied.
 *   5. The WS upgrade itself performs no authorization or actor resolution —
 *      that now happens once, at ticket-mint time, through the ordinary
 *      `terminal.mintTicket` oRPC procedure (see ./od-5j8.2's updated
 *      transport-parity assertions for the structural half of this).
 * Origin-check and "no cookie/ticket-less upgrade" behavior are exercised as
 * real HTTP requests against the actual handler in
 * apps/server/src/handlers/terminal/__tests__/ws.test.ts — that file owns
 * the transport, this one owns the ticket/authz primitives it's built on.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";

import type { ApiKeyActor, SessionActor } from "../../authz/actor";

// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
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

const { mintTerminalTicket, consumeTerminalTicket } =
  await import("../../routers/terminal/tickets");
const { authorizeTerminalTarget } = await import("../../routers/terminal/authorize");
const { grantStepUp, hasRecentStepUp, clearStepUp } = await import("../../authz/step-up");

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");
function readSource(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

const uid = (label: string) => `${label}_${crypto.randomUUID()}`;

describe("[od-5j8.9] a ticket is single-use — replay fails", () => {
  test("consuming a minted ticket twice: first succeeds, second is rejected", async () => {
    const userId = uid("user");
    const organizationId = uid("org");
    const minted = await mintTerminalTicket({
      userId,
      organizationId,
      target: { kind: "host" },
      clientIp: null,
    });

    const first = await consumeTerminalTicket(minted.token, { clientIp: null });
    expect(first.isOk()).toBe(true);
    if (first.isOk()) {
      expect(first.value).toMatchObject({ userId, organizationId, target: { kind: "host" } });
    }

    const replay = await consumeTerminalTicket(minted.token, { clientIp: null });
    expect(replay.isErr()).toBe(true);
    if (replay.isErr()) {
      expect(replay.error.reason).toBe("invalid_or_replayed");
      expect(replay.error.status).toBe(401);
    }
  });

  test("two upgrade attempts racing the same ticket: exactly one wins", async () => {
    const minted = await mintTerminalTicket({
      userId: uid("user"),
      organizationId: uid("org"),
      target: { kind: "container", id: "container-race" },
      clientIp: null,
    });

    const [a, b] = await Promise.all([
      consumeTerminalTicket(minted.token, { clientIp: null }),
      consumeTerminalTicket(minted.token, { clientIp: null }),
    ]);
    const outcomes = [a, b];
    expect(outcomes.filter((r) => r.isOk())).toHaveLength(1);
    expect(outcomes.filter((r) => r.isErr())).toHaveLength(1);
  });

  test("an unknown/garbage ticket is rejected the same way a replay is", async () => {
    const result = await consumeTerminalTicket("this-token-was-never-minted", { clientIp: null });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.reason).toBe("invalid_or_replayed");
  });
});

describe("[od-5j8.9] a ticket is target-bound — no cross-target substitution", () => {
  test("a ticket minted for container A resolves only to container A, never container B", async () => {
    const userId = uid("user");
    const organizationId = uid("org");

    const ticketA = await mintTerminalTicket({
      userId,
      organizationId,
      target: { kind: "container", id: "container-A" },
      clientIp: null,
    });
    const ticketB = await mintTerminalTicket({
      userId,
      organizationId,
      target: { kind: "container", id: "container-B" },
      clientIp: null,
    });

    const claimsA = await consumeTerminalTicket(ticketA.token, { clientIp: null });
    const claimsB = await consumeTerminalTicket(ticketB.token, { clientIp: null });

    expect(claimsA.isOk()).toBe(true);
    expect(claimsB.isOk()).toBe(true);
    if (claimsA.isOk())
      expect(claimsA.value.target).toEqual({ kind: "container", id: "container-A" });
    if (claimsB.isOk())
      expect(claimsB.value.target).toEqual({ kind: "container", id: "container-B" });
  });

  test("structurally: the WS upgrade accepts no client-supplied target — nothing to substitute", () => {
    const text = readSource("apps/server/src/handlers/terminal/ws.ts");
    // The old `?container=`/`?host=1` query params are gone; the target
    // comes exclusively from the consumed ticket's claims.
    expect(text).not.toContain('c.req.query("container")');
    expect(text).not.toContain('c.req.query("host")');
    expect(text).toContain("consumeTerminalTicket(");
    expect(text).toContain("claims.target");
  });
});

describe("[od-5j8.9] an expired ticket fails", () => {
  test("a ticket minted with a 1s TTL is rejected once it has expired", async () => {
    const minted = await mintTerminalTicket(
      { userId: uid("user"), organizationId: uid("org"), target: { kind: "host" }, clientIp: null },
      1,
    );
    await new Promise((r) => setTimeout(r, 1_200));

    const result = await consumeTerminalTicket(minted.token, { clientIp: null });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.reason).toBe("invalid_or_replayed");
  });
});

describe("[od-5j8.9] ticket IP binding is enforced when both ends resolved an address", () => {
  test("a ticket minted for one client IP is rejected when consumed from a different one", async () => {
    const minted = await mintTerminalTicket({
      userId: uid("user"),
      organizationId: uid("org"),
      target: { kind: "host" },
      clientIp: "203.0.113.10",
    });
    const result = await consumeTerminalTicket(minted.token, { clientIp: "198.51.100.20" });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.reason).toBe("ip_mismatch");
  });

  test("a ticket with no resolvable IP on either end is not blocked by IP binding", async () => {
    const minted = await mintTerminalTicket({
      userId: uid("user"),
      organizationId: uid("org"),
      target: { kind: "host" },
      clientIp: null,
    });
    const result = await consumeTerminalTicket(minted.token, { clientIp: null });
    expect(result.isOk()).toBe(true);
  });
});

describe("[od-5j8.9] the host terminal is install-admin only", () => {
  const orgMember: SessionActor = {
    kind: "session",
    headers: new Headers(),
    user: {
      id: "user_member",
      email: "member@example.test",
      isInstallAdmin: false,
      twoFactorEnabled: true,
    },
    session: { activeOrganizationId: "org_1" },
  };
  const installAdmin: SessionActor = {
    ...orgMember,
    user: { ...orgMember.user, id: "user_admin", isInstallAdmin: true },
  };

  test("an ordinary organization member is denied the host shell, even with terminal:open", async () => {
    const decision = await authorizeTerminalTarget(orgMember, "org_1", { kind: "host" });
    expect(decision.isErr()).toBe(true);
    if (decision.isErr()) {
      expect(decision.error.status).toBe(403);
      expect(decision.error.message).toMatch(/installation administrator/i);
    }
  });

  test("an install admin is authorized for the host shell", async () => {
    const decision = await authorizeTerminalTarget(installAdmin, "org_1", { kind: "host" });
    expect(decision.isOk()).toBe(true);
  });

  test("an organization API key — however broadly scoped — can never open the host shell", async () => {
    const broadKey: ApiKeyActor = {
      kind: "api-key",
      id: "key_1",
      organizationId: "org_1",
      permissions: null,
      accessLevel: "write",
      projectScope: "all",
    };
    const decision = await authorizeTerminalTarget(broadKey, "org_1", { kind: "host" });
    expect(decision.isErr()).toBe(true);
    if (decision.isErr()) expect(decision.error.status).toBe(403);
  });

  test("an unauthenticated actor is denied 401, not a silent pass-through", async () => {
    const decision = await authorizeTerminalTarget(null, "org_1", { kind: "host" });
    expect(decision.isErr()).toBe(true);
    if (decision.isErr()) expect(decision.error.status).toBe(401);
  });

  // Container-ownership authorization (a container must be org-owned before
  // any capability check runs) needs a real DB/docker daemon, which this
  // pure security suite deliberately doesn't depend on — the org-scope
  // capability decision itself is already covered by
  // od-5j8.2-capability-authz-matrix.test.ts. Structural check that the
  // container branch still goes through org-ownership discovery first:
  test("structurally: the container branch checks org ownership via listTerminalTargets before authorizing", () => {
    const text = readSource("packages/api/src/routers/terminal/authorize.ts");
    expect(text).toContain("listTerminalTargets(");
    expect(text).toContain('permission: { terminal: ["open"] }');
  });
});

describe("[od-5j8.9] step-up grants are short-lived and scoped per user", () => {
  test("granting step-up for a user makes hasRecentStepUp true for that user only", async () => {
    const grantedUser = uid("user");
    const otherUser = uid("user");

    expect(await hasRecentStepUp(grantedUser)).toBe(false);
    await grantStepUp(grantedUser);
    expect(await hasRecentStepUp(grantedUser)).toBe(true);
    expect(await hasRecentStepUp(otherUser)).toBe(false);

    await clearStepUp(grantedUser);
    expect(await hasRecentStepUp(grantedUser)).toBe(false);
  });
});

describe("[od-5j8.9] mintTicket requires an interactive step-up grant (structural)", () => {
  test("the mintTicket handler checks hasRecentStepUp before minting", () => {
    const text = readSource("packages/api/src/routers/terminal/index.ts");
    expect(text).toContain("hasRecentStepUp(");
    expect(text).toContain("STEP_UP_REQUIRED");
    expect(text).toContain("mintTerminalTicket(");
  });

  test("the mintTicket handler rejects API-key actors — a real interactive session is required", () => {
    const text = readSource("packages/api/src/routers/terminal/index.ts");
    expect(text).toContain("INTERACTIVE_SESSION_REQUIRED");
    expect(text).toMatch(/if \(!context\.session\)/);
  });
});
