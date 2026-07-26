/**
 * od-5j8.20 — mutually authenticated, least-privilege node health agent.
 *
 * Before this: every agent task in the swarm-wide GLOBAL service shared ONE
 * HMAC bearer, valid for a year, re-minted only on image/URL drift. Any
 * holder could POST a health report claiming to be ANY hostname (the design
 * doc's own "Trust model v1" admission), and removing one node from the
 * swarm did not revoke its ability to keep POSTing until the next
 * drift-triggered service recreation.
 *
 * v2 replaces the report bearer with a per-node SESSION credential
 * (agent-credential.ts): short-lived (1h), DB-backed (so it's revocable
 * before its TTL — a pure HMAC token can't be without a denylist), and
 * bound at mint time to exactly one (serverId, hostname) pair. The shared
 * bearer survives only as a bootstrap credential good for nothing but
 * calling `/api/agent/register` to obtain a session credential — see
 * agent-token.ts / agent-register.ts.
 *
 * Invariants under test:
 *   1. `parseSessionCredential` is a hostile-path-hardened parser (same
 *      corpus discipline as od-5j8.4's enrollment-credential tests) — no
 *      malformed bearer reaches a DB lookup.
 *   2. `hashSessionSecret` never leaks the plaintext secret and is
 *      deterministic (a digest comparison actually works).
 *   3. The ingest route enforces hostname binding: a session credential's
 *      claimed hostname must match what it was minted for, or the request
 *      is refused — the exact "any holder can claim any hostname" gap the
 *      design doc documented.
 *   4. Node removal revokes this node's credentials immediately, not on the
 *      next drift-triggered recreation, and the DB is defense-in-depth via
 *      an FK cascade delete.
 *   5. The bootstrap credential (still a shared, swarm-wide token) is
 *      narrowed to bootstrap-only, short-lived, and force-rotated by the
 *      reconciler independent of image/URL drift — "identities rotate
 *      automatically".
 *   6. Docker socket access from the agent's own code stays to the single
 *      read-only call it always made — the credential rework doesn't widen
 *      the local privilege surface.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";

import { hashSessionSecret, parseSessionCredential } from "../../system-health/agent-credential";

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");

function source(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

// ─── parseSessionCredential hostile-path corpus ─────────────────────────────

describe("[od-5j8.20] session-credential parsing/hashing hostile-path corpus", () => {
  const validId = "hac_abcdefghijkmnpqrstuvwxyz";
  const validSecret = "a".repeat(43);

  test.each([
    ["wrong id prefix", `server_abcdefghijkmnpqrstuvwxyz.${validSecret}`],
    ["enrollment id prefix (cross-scheme confusion)", `enroll_abcdefghijkmnpqrstuvwxyz.${validSecret}`],
    ["secret too short", `${validId}.short`],
    ["secret too long", `${validId}.${"a".repeat(44)}`],
    ["secret with a non-base64url character", `${validId}.${"a".repeat(42)}!`],
    ["missing secret entirely", validId],
    ["empty string", ""],
    ["path traversal attempt in id", `hac_../../../etc/passwd.${validSecret}`],
    ["SQL-injection-shaped id", `hac_' OR '1'='1.${validSecret}`],
    ["null byte embedded", `${validId} .${validSecret}`],
    ["extra segments (id.secret.secret)", `${validId}.${validSecret}.${validSecret}`],
    ["whitespace padding", ` ${validId}.${validSecret} `],
    ["a well-formed legacy agent-token instead (disjoint schemes)", "eyJwIjoiaGVhbHRoLWFnZW50In0.c2lnbmF0dXJl"],
  ])("rejects malformed credential: %s", (_label, candidate) => {
    expect(parseSessionCredential(candidate)).toBeNull();
  });

  test("accepts a well-formed credential", () => {
    expect(parseSessionCredential(`${validId}.${validSecret}`)).toEqual({ id: validId });
  });

  test("hashSessionSecret is deterministic", () => {
    const credential = `${validId}.${validSecret}`;
    expect(hashSessionSecret(credential)).toBe(hashSessionSecret(credential));
  });

  test("hashSessionSecret never contains the plaintext bearer as a substring", () => {
    const credential = `${validId}.${validSecret}`;
    const digest = hashSessionSecret(credential);
    expect(digest).not.toContain(validSecret);
    expect(digest).not.toContain(validId);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  test("two different secrets for the same id hash to different digests", () => {
    const a = `${validId}.${"a".repeat(43)}`;
    const b = `${validId}.${"b".repeat(43)}`;
    expect(hashSessionSecret(a)).not.toBe(hashSessionSecret(b));
  });
});

// ─── never persists the plaintext secret ────────────────────────────────────

describe("[od-5j8.20] only a digest is ever persisted", () => {
  test("issueSessionCredential stores tokenHash, never the bearer, and returns the bearer exactly once", () => {
    const credential = source("packages/api/src/system-health/agent-credential.ts");
    expect(credential).toContain("tokenHash: hashSessionSecret(credential)");
    expect(credential).not.toMatch(/\bsecret:\s*secret\b/);
    expect(credential).toMatch(/return \{ credential, expiresAt \};/);
  });

  test("verifySessionCredential compares the digest in constant time, not the plaintext", () => {
    const credential = source("packages/api/src/system-health/agent-credential.ts");
    const fn = credential.match(/export async function verifySessionCredential[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain("timingSafeEqual(expectedHash, presentedHash)");
  });

  test("the DB table has a unique index on token_hash, not on any plaintext column", () => {
    const schema = source("packages/db/src/schema/server.ts");
    const table = schema.match(/export const healthAgentCredential = pgTable\(([\s\S]*?)\n\);/)?.[0] ?? "";
    expect(table).toContain('tokenHash: text("token_hash").notNull().unique()');
  });
});

// ─── hostname binding: the core "cannot impersonate another node" fix ─────

describe("[od-5j8.20] a session credential is bound to one (serverId, hostname) and cannot claim another", () => {
  test("issueSessionCredential binds serverId AND hostname at mint time", () => {
    const credential = source("packages/api/src/system-health/agent-credential.ts");
    expect(credential).toContain("serverId: input.serverId");
    expect(credential).toContain("hostname: input.hostname");
  });

  test("the ingest handler rejects a report whose claimed hostname differs from the credential's bound hostname", () => {
    const ingest = source("packages/api/src/system-health/agent-ingest.ts");
    const fn = ingest.match(/export async function agentHealthIngestHandler[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain("if (session.hostname !== parsed.data.hostname) {");
    expect(fn).toMatch(/event:\s*"hostname-claim-mismatch"/);
    expect(fn).toContain('c.json({ error: "hostname claim does not match the credential\'s bound hostname" }, 403)');
  });

  test("the register route mints the credential's hostname from the caller's own registration claim, not the ingest report", () => {
    const register = source("packages/api/src/system-health/agent-register.ts");
    expect(register).toContain("hostname: parsed.data.hostname");
  });
});

// ─── immediate revocation on node removal ───────────────────────────────────

describe("[od-5j8.20] node removal revokes health-agent credentials immediately", () => {
  test("removeServerNode revokes this server's credentials right after the swarm detach succeeds, best-effort", () => {
    const removeNode = source("packages/api/src/routers/server/remove-node.ts");
    expect(removeNode).toContain("revokeHealthAgentCredentialsForServer(input.id)");
    // Best-effort: a revoke failure must not undo an otherwise-successful
    // swarm removal — it's chained with .catch, not awaited bare.
    const call = removeNode.match(/await revokeHealthAgentCredentialsForServer\(input\.id\)[\s\S]*?\);/)?.[0] ?? "";
    expect(call).toContain(".catch(");
  });

  test("revocation happens BEFORE the swarm-removal success is reported (ordering, not an afterthought)", () => {
    const removeNode = source("packages/api/src/routers/server/remove-node.ts");
    const revokeIdx = removeNode.indexOf("revokeHealthAgentCredentialsForServer(input.id)");
    const okIdx = removeNode.indexOf("Result.ok({ ok: true })");
    expect(revokeIdx).toBeGreaterThan(-1);
    expect(okIdx).toBeGreaterThan(revokeIdx);
  });

  test("revokeHealthAgentCredentialsForServer only touches not-yet-revoked rows for that server (idempotent, scoped)", () => {
    const credential = source("packages/api/src/system-health/agent-credential.ts");
    const fn = credential.match(/export async function revokeHealthAgentCredentialsForServer[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain("eq(healthAgentCredential.serverId, serverId)");
    expect(fn).toContain("isNull(healthAgentCredential.revokedAt)");
  });

  test("deleting the server row cascade-deletes its credentials too — defense in depth if the explicit revoke is ever skipped", () => {
    const schema = source("packages/db/src/schema/server.ts");
    const table = schema.match(/export const healthAgentCredential = pgTable\(([\s\S]*?)\n\);/)?.[0] ?? "";
    expect(table).toMatch(/serverId: text\("server_id"\)[\s\S]*?onDelete: "cascade"/);
  });

  test("od-5j8.29 note: this closes the credential-revocation-on-removal gap for the health-agent credential specifically", () => {
    const removeNode = source("packages/api/src/routers/server/remove-node.ts");
    expect(removeNode).toContain("od-5j8.20 / od-5j8.29");
  });
});

// ─── expiry is real, not merely advisory ───────────────────────────────────

describe("[od-5j8.20] session credentials actually expire and are short-lived", () => {
  test("SESSION_TTL_SECONDS is short (≤ a few hours), not year-scale", async () => {
    const { SESSION_TTL_SECONDS } = await import("../../system-health/agent-credential");
    expect(SESSION_TTL_SECONDS).toBeLessThanOrEqual(6 * 60 * 60);
    expect(SESSION_TTL_SECONDS).toBeGreaterThan(0);
  });

  test("verifySessionCredential checks expiresAt and revokedAt before accepting", () => {
    const credential = source("packages/api/src/system-health/agent-credential.ts");
    const fn = credential.match(/export async function verifySessionCredential[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain("if (row.revokedAt) return null;");
    expect(fn).toContain("if (row.expiresAt.getTime() < Date.now()) return null;");
  });
});

// ─── bootstrap credential: narrowed scope + forced rotation ────────────────

describe("[od-5j8.20] the surviving shared credential is bootstrap-only and force-rotates", () => {
  test("the bootstrap token purpose is distinct from the legacy report-bearer purpose (can't be confused for one another)", () => {
    const token = source("packages/api/src/system-health/agent-token.ts");
    expect(token).toContain('const BOOTSTRAP_PURPOSE = "health-agent-bootstrap";');
    expect(token).toContain('const LEGACY_PURPOSE = "health-agent";');
  });

  test("the bootstrap token TTL is dramatically shorter than the old 1-year shared bearer", () => {
    const token = source("packages/api/src/system-health/agent-token.ts");
    expect(token).toContain("const BOOTSTRAP_TTL_SECONDS = 24 * 60 * 60;");
    expect(token).toContain("const LEGACY_TTL_SECONDS = 365 * 24 * 60 * 60;");
  });

  test("the reconciler forces a recreate (fresh bootstrap token) once the current one is stale, independent of image/URL drift", () => {
    const service = source("packages/api/src/system-health/agent-service.ts");
    expect(service).toContain("const BOOTSTRAP_TOKEN_MAX_AGE_SECONDS = 12 * 60 * 60;");
    expect(service).toContain("tokenStale");
    expect(service).toMatch(/drifted =\s*\n?\s*labels\["otterdeploy\.agent\.image"\] !== image \|\|\s*\n?\s*labels\["otterdeploy\.agent\.ingest"\] !== ingestUrl \|\|\s*\n?\s*tokenStale;/);
  });

  test("the bootstrap token is never used as the /api/agent/health bearer by any new-code path", () => {
    const healthAgent = source("apps/server/src/health-agent.ts");
    expect(healthAgent).not.toMatch(/doReport\(BOOTSTRAP_TOKEN\)/);
    expect(healthAgent).toContain("authorization: `Bearer ${BOOTSTRAP_TOKEN}`");
    expect(healthAgent).toContain("authorization: `Bearer ${credential}`");
    // The bootstrap token is only ever sent to /register, never to /health.
    const registerCall = healthAgent.match(/async function register\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(registerCall).toContain("REGISTER_URL");
    expect(registerCall).not.toContain("INGEST_URL");
  });
});

// ─── transition: old and new schemes both accepted, neither silently trusted forever ───

describe("[od-5j8.20] migration path — legacy agents keep working, but are visibly deprecated", () => {
  test("the ingest handler tries the session-credential scheme first, and only falls back to the legacy bearer", () => {
    const ingest = source("packages/api/src/system-health/agent-ingest.ts");
    const sessionIdx = ingest.indexOf("if (parseSessionCredential(token)) {");
    const legacyIdx = ingest.indexOf("if (!(await verifyAgentToken(token))) {");
    expect(sessionIdx).toBeGreaterThan(-1);
    expect(legacyIdx).toBeGreaterThan(sessionIdx);
  });

  test("legacy-bearer usage is logged so operators can watch it taper to zero", () => {
    const ingest = source("packages/api/src/system-health/agent-ingest.ts");
    expect(ingest).toContain('event: "legacy-bearer-used"');
  });

  test("a request with neither a parseable session credential nor a valid legacy token is rejected, never silently accepted", () => {
    const ingest = source("packages/api/src/system-health/agent-ingest.ts");
    const fn = ingest.match(/export async function agentHealthIngestHandler[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain('return c.json({ error: "invalid agent token" }, 401);');
  });
});

// ─── Docker socket: the credential rework doesn't widen local privilege ───

describe("[od-5j8.20] the health agent's own Docker access stays to a single read-only call", () => {
  test("host-health.ts (what the agent samples) makes exactly one Docker API call: system.df()", () => {
    const hostHealth = source("packages/api/src/system-health/host-health.ts");
    const dockerCalls = hostHealth.match(/docker\.[a-zA-Z]+\.[a-zA-Z]+\(/g) ?? [];
    expect(dockerCalls).toEqual(["docker.system.df("]);
  });

  test("the ingest route itself never touches Docker — a captured report-path credential still cannot control Docker", () => {
    const ingest = source("packages/api/src/system-health/agent-ingest.ts");
    expect(ingest).not.toContain("@otterdeploy/docker");
    expect(ingest).not.toContain("Docker.fromEnv");
  });

  test("known residual gap, documented rather than silently left implicit: the agent container still holds the raw docker.sock (narrowing that further needs a socket-proxy sidecar — out of scope this pass, see bd notes)", () => {
    const service = source("packages/api/src/system-health/agent-service.ts");
    expect(service).toContain("/var/run/docker.sock");
  });
});
