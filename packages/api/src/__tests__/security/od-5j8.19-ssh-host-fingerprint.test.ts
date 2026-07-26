/**
 * od-5j8.19 — verified SSH host trust.
 *
 * Before this: `SshSession.connect()` passed NO `hostVerifier` to ssh2 at
 * all — every host key was accepted unconditionally (documented as
 * intentional TOFU, "phase 2" pinning never built). MITM host-key
 * substitution on the very first connection — the exact moment the platform
 * hands a fresh VPS its firewall config, swarm join token, and managed SSH
 * key — succeeded silently.
 *
 * Invariants under test:
 *   1. `computeHostFingerprint` is a deterministic, OpenSSH-shaped digest
 *      that differs for different keys (so a substituted key is detectable
 *      at all).
 *   2. `SshSession.connect()` — driven end-to-end against a fake `ssh2`
 *      transport — accepts on trust when no fingerprint is pinned yet
 *      (first contact) but ALWAYS returns the observed fingerprint, and
 *      REJECTS closed with `HostKeyMismatchError` the moment a pinned
 *      fingerprint doesn't match what the host presents, before any
 *      authentication is attempted.
 *   3. Both call sites that reconnect to a host over SSH
 *      (provision-runner.ts's initial provision, and
 *      firewall-remediation.ts's reprovision/remediation path the audit
 *      named explicitly) resolve `expectedFingerprint` from the server row
 *      and pin on first contact — so every connection after the first is
 *      verified, not just accepted.
 *   4. The confirm/rotate endpoint requires the exact typed phrase to
 *      change a pinned value, and a bare "it matches" confirm never needs
 *      one — mirroring the manager-enrollment step-up pattern already used
 *      elsewhere in this router.
 */
import { EventEmitter } from "node:events";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");

function source(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

// ─── computeHostFingerprint ─────────────────────────────────────────────────

describe("[od-5j8.19] computeHostFingerprint", () => {
  test("is deterministic and OpenSSH-shaped (SHA256:<43-char base64url-ish, no padding>)", async () => {
    const { computeHostFingerprint } = await import("../../routers/server/ssh-exec");
    const key = Buffer.from("a fake ssh host public key blob");
    const fp1 = computeHostFingerprint(key);
    const fp2 = computeHostFingerprint(key);
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    expect(fp1).not.toContain("=");
  });

  test("different keys produce different fingerprints", async () => {
    const { computeHostFingerprint } = await import("../../routers/server/ssh-exec");
    const fpA = computeHostFingerprint(Buffer.from("key A"));
    const fpB = computeHostFingerprint(Buffer.from("key B"));
    expect(fpA).not.toBe(fpB);
  });

  test("a single changed byte (the shape of an in-flight key substitution) changes the fingerprint entirely", async () => {
    const { computeHostFingerprint } = await import("../../routers/server/ssh-exec");
    const legit = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const mitm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 9]);
    expect(computeHostFingerprint(legit)).not.toBe(computeHostFingerprint(mitm));
  });
});

// ─── SshSession.connect() against a fake ssh2 transport ────────────────────

/** A minimal fake of ssh2's `Client` — enough surface for `SshSession.connect`
 *  to drive a full handshake: it calls `hostVerifier` with a configurable raw
 *  key, honors the verifier's accept/reject decision exactly like ssh2's real
 *  kex.js does (including ssh2's own "Host denied (verification failed)" /
 *  `level: "handshake"` shape on rejection), and never calls back at all on
 *  a config that doesn't set a `hostVerifier` — so a regression that drops
 *  the option again (the original bug) makes these tests hang/timeout rather
 *  than silently pass. */
function makeFakeSsh2(hostKeyBytes: Buffer) {
  class FakeClient extends EventEmitter {
    connect(config: {
      hostVerifier?: (key: Buffer, verify: (ok: boolean) => void) => void;
    }): void {
      if (!config.hostVerifier) {
        throw new Error("test double: no hostVerifier was configured — connect() must always set one");
      }
      config.hostVerifier(hostKeyBytes, (permitted: boolean) => {
        queueMicrotask(() => {
          if (permitted) {
            this.emit("ready");
          } else {
            const err = Object.assign(new Error("Host denied (verification failed)"), {
              level: "handshake",
            });
            this.emit("error", err);
          }
        });
      });
    }
    end(): void {}
  }
  return { Client: FakeClient };
}

describe("[od-5j8.19] SshSession.connect() host-key verification", () => {
  afterEach(() => {
    vi.doUnmock("ssh2");
    vi.resetModules();
  });

  test("first contact (no pinned fingerprint): accepts on trust and returns the observed fingerprint", async () => {
    const hostKey = Buffer.from("first-contact host key");
    vi.doMock("ssh2", () => makeFakeSsh2(hostKey));
    const { SshSession, computeHostFingerprint } = await import("../../routers/server/ssh-exec");

    const session = await SshSession.connect({
      host: "203.0.113.10",
      port: 22,
      user: "root",
      privateKey: "fake-pem",
    });
    expect(session.hostFingerprint).toBe(computeHostFingerprint(hostKey));
  });

  test("pinned fingerprint matches: connects normally", async () => {
    const hostKey = Buffer.from("returning host, same key");
    vi.doMock("ssh2", () => makeFakeSsh2(hostKey));
    const { SshSession, computeHostFingerprint } = await import("../../routers/server/ssh-exec");
    const pinned = computeHostFingerprint(hostKey);

    const session = await SshSession.connect({
      host: "203.0.113.10",
      port: 22,
      user: "root",
      privateKey: "fake-pem",
      expectedFingerprint: pinned,
    });
    expect(session.hostFingerprint).toBe(pinned);
  });

  test("pinned fingerprint mismatch (MITM shape): fails CLOSED with HostKeyMismatchError, never reaches 'ready'", async () => {
    const presentedKey = Buffer.from("an intercepting host's key");
    vi.doMock("ssh2", () => makeFakeSsh2(presentedKey));
    const { SshSession, HostKeyMismatchError, computeHostFingerprint } = await import(
      "../../routers/server/ssh-exec"
    );
    const pinnedFromBeforeTheMitm = computeHostFingerprint(Buffer.from("the real host's key"));

    await expect(
      SshSession.connect({
        host: "203.0.113.10",
        port: 22,
        user: "root",
        privateKey: "fake-pem",
        expectedFingerprint: pinnedFromBeforeTheMitm,
      }),
    ).rejects.toThrow(HostKeyMismatchError);
  });

  test("the mismatch error carries both fingerprints for the operator to compare", async () => {
    const presentedKey = Buffer.from("presented key");
    vi.doMock("ssh2", () => makeFakeSsh2(presentedKey));
    const { SshSession, HostKeyMismatchError, computeHostFingerprint } = await import(
      "../../routers/server/ssh-exec"
    );
    const expected = computeHostFingerprint(Buffer.from("expected key"));

    try {
      await SshSession.connect({
        host: "203.0.113.10",
        port: 22,
        user: "root",
        privateKey: "fake-pem",
        expectedFingerprint: expected,
      });
      expect.unreachable("connect() must reject on a fingerprint mismatch");
    } catch (err) {
      expect(err).toBeInstanceOf(HostKeyMismatchError);
      const mismatch = err as InstanceType<typeof HostKeyMismatchError>;
      expect(mismatch.expectedFingerprint).toBe(expected);
      expect(mismatch.presentedFingerprint).toBe(computeHostFingerprint(presentedKey));
    }
  });

  test("an empty/garbage expectedFingerprint never accidentally matches a real key", async () => {
    const hostKey = Buffer.from("some real host key");
    vi.doMock("ssh2", () => makeFakeSsh2(hostKey));
    const { SshSession, HostKeyMismatchError } = await import("../../routers/server/ssh-exec");

    await expect(
      SshSession.connect({
        host: "203.0.113.10",
        port: 22,
        user: "root",
        privateKey: "fake-pem",
        expectedFingerprint: "",
      }),
    ).resolves.toBeDefined(); // empty string is falsy → treated as "no pin", same as null/undefined

    await expect(
      SshSession.connect({
        host: "203.0.113.10",
        port: 22,
        user: "root",
        privateKey: "fake-pem",
        expectedFingerprint: "SHA256:not-the-real-fingerprint-at-all",
      }),
    ).rejects.toThrow(HostKeyMismatchError);
  });
});

// ─── every reconnect path re-verifies, not just the first one ─────────────

describe("[od-5j8.19] every SSH reconnect path pins/verifies the host key", () => {
  test("provision-runner.ts resolves the server row's pinned fingerprint before connecting, and fails closed on HostKeyMismatchError", () => {
    const runner = source("packages/api/src/routers/server/provision-runner.ts");
    expect(runner).toContain("const existing = await getServerInOrg({ serverId, organizationId });");
    expect(runner).toContain("const pinned = existing?.hostFingerprint ?? null;");
    expect(runner).toContain("expectedFingerprint");
    expect(runner).toContain("HostKeyMismatchError");
    expect(runner).toContain("pinHostFingerprintOnFirstContact");
  });

  test("firewall-remediation.ts (the reprovision/remediation reconnect path) does the same — not just the initial provision", () => {
    const remediation = source("packages/api/src/routers/server/firewall-remediation.ts");
    expect(remediation).toContain("const pinned = existing?.hostFingerprint ?? null;");
    expect(remediation).toContain("expectedFingerprint: pinned");
    expect(remediation).toContain("HostKeyMismatchError");
    expect(remediation).toContain("pinHostFingerprintOnFirstContact");
  });

  test("a pinned row is NEVER silently overwritten by a fresh operator-supplied or trust-on-first-use value", () => {
    const runner = source("packages/api/src/routers/server/provision-runner.ts");
    // `pinned` (from the DB row) wins over `payload.expectedHostFingerprint`
    // (a fresh operator claim) in the ?? chain — pinning only ever happens
    // once, on an unpinned row.
    expect(runner).toContain("const expectedFingerprint = pinned ?? payload.expectedHostFingerprint ?? null;");
    const helper = source("packages/api/src/routers/server/host-fingerprint.ts");
    expect(helper).toContain("if (input.alreadyPinned) return;");
  });

  test("first-contact pinning is a security-relevant event: it is logged, not silent", () => {
    const helper = source("packages/api/src/routers/server/host-fingerprint.ts");
    expect(helper).toContain('event: "ssh-host-key-pinned"');
    const runner = source("packages/api/src/routers/server/provision-runner.ts");
    expect(runner).toContain('event: "ssh-host-key-mismatch"');
  });
});

// ─── DB migration: additive-only, honest default ───────────────────────────

describe("[od-5j8.19] the pinned fingerprint is a real, additive DB column", () => {
  test("server.host_fingerprint defaults to null (honest: no pin means no pin, never a fake 'trusted')", () => {
    const schema = source("packages/db/src/schema/server.ts");
    expect(schema).toContain("hostFingerprint: text(\"host_fingerprint\"),");
    expect(schema).toContain(
      'hostFingerprintVerified: boolean("host_fingerprint_verified").notNull().default(false)',
    );
  });

  test("a migration adds the fingerprint columns without dropping or rewriting existing server rows", () => {
    const migrationsDir = resolve(repositoryRoot, "packages/db/src/migrations");
    const dirs = readdirSync(migrationsDir).filter((d) => !d.startsWith(".") && d !== "meta");
    const match = dirs.find((d) => {
      const file = join(migrationsDir, d, "migration.sql");
      return existsSync(file) && readFileSync(file, "utf8").includes("host_fingerprint");
    });
    expect(match, "no migration adds host_fingerprint").toBeDefined();
    const sql = readFileSync(join(migrationsDir, match as string, "migration.sql"), "utf8");
    expect(sql).toContain('ADD COLUMN "host_fingerprint"');
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain("DROP COLUMN");
    // Existing (pre-od-5j8.19) rows read back with hostFingerprint = NULL —
    // exactly the "no pin yet, so TOFU-pin-on-next-connect" migration path,
    // never a locked-out fleet.
    expect(sql).not.toMatch(/UPDATE "server"/);
  });
});

// ─── confirm / rotate step-up ───────────────────────────────────────────────

describe("[od-5j8.19] confirming/rotating a pinned fingerprint requires proof of intent", () => {
  test("a matching value only confirms (marks verified) — no typed phrase required", () => {
    const handlers = source("packages/api/src/routers/server/handlers.ts");
    const fn = handlers.match(/export async function confirmHostFingerprint[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain("if (supplied === existing.hostFingerprint) {");
    expect(fn).toContain("confirmServerHostFingerprint(");
  });

  test("a DIFFERENT value is a rotation and is refused without the exact confirmation phrase", () => {
    const handlers = source("packages/api/src/routers/server/handlers.ts");
    const fn = handlers.match(/export async function confirmHostFingerprint[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain('if (input.confirmation !== HOST_KEY_ROTATION_PHRASE) {');
    expect(fn).toContain("HostFingerprintRotationRequiredError");
    expect(handlers).toContain('const HOST_KEY_ROTATION_PHRASE = "ROTATE HOST KEY";');
  });

  test("confirming before any connection has ever pinned a fingerprint is refused, not silently accepted", () => {
    const handlers = source("packages/api/src/routers/server/handlers.ts");
    const fn = handlers.match(/export async function confirmHostFingerprint[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain("if (!existing.hostFingerprint) {");
    expect(fn).toContain("HostFingerprintPendingError");
  });

  test("both the confirm and rotate branches log a security-relevant event", () => {
    const handlers = source("packages/api/src/routers/server/handlers.ts");
    expect(handlers).toContain('event: "host-fingerprint-confirmed"');
    expect(handlers).toContain('event: "host-fingerprint-rotated"');
  });

  test("the endpoint is gated behind server:update permission, not left open to any org member", () => {
    const router = source("packages/api/src/routers/server/index.ts");
    expect(router).toMatch(
      /confirmHostFingerprint: requirePermission\(\{\s*server: \["update"\],?\s*\}\)/,
    );
  });
});
