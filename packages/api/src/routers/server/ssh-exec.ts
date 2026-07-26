/**
 * Minimal SSH command transport for remote-server provisioning — a thin
 * wrapper over `ssh2`'s `Client` (lazy-loaded, optional dep). We connect OUT to
 * a host, run bash scripts, and stream their output line-by-line. This is the
 * *bootstrap* transport only (install Docker, join the swarm); once a node is
 * in the swarm it's managed through the manager socket, never through here.
 * Design: docs/designs/server-onboarding.md
 *
 * Same posture as keygen.ts / storage.ts: these functions THROW; the job /
 * handler layer wraps them in `Result.tryPromise` so Result-typed code stays
 * free of raw try/catch.
 *
 * ── Host-key verification (od-5j8.19) ───────────────────────────────────────
 * `connect()` always computes the presented host key's fingerprint. When the
 * caller passes `expectedFingerprint` (the server row's pinned value, once
 * one exists) it is enforced via ssh2's `hostVerifier` — a mismatch fails the
 * connection closed (`HostKeyMismatchError`), before any auth is attempted.
 * When no `expectedFingerprint` is given (first-ever contact with a host, or
 * an install upgraded from before this feature existed) the key is accepted
 * on trust — same trust-on-first-use posture SSH itself defaults to — but the
 * *observed* fingerprint is always returned on `session.hostFingerprint` so
 * the caller can pin it for every connection after this one. There is no way
 * to skip pinning: every successful connect leaves the caller holding a
 * fingerprint to persist.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import type { Client as SshClient } from "ssh2";

const SSH2_MISSING =
  "ssh2 is not installed — run `bun install` to enable remote server provisioning " +
  "(it's an optional dependency so single-host installs don't pay for its native build).";

/** Raised when a pinned host-key fingerprint doesn't match what the host
 *  presented — a hard stop, never silently downgraded to TOFU. Carries both
 *  sides so the operator can tell "key rotated legitimately" (rebuilt VPS)
 *  from "something is intercepting this connection" and decide whether to
 *  rotate the pin via `server.confirmHostFingerprint`. */
export class HostKeyMismatchError extends Error {
  readonly expectedFingerprint: string;
  readonly presentedFingerprint: string;
  constructor(expectedFingerprint: string, presentedFingerprint: string) {
    super(
      `SSH host key mismatch: this host presented ${presentedFingerprint}, but ` +
        `${expectedFingerprint} is pinned on record. Refusing to connect — this could mean the ` +
        `host was legitimately rebuilt/reimaged, OR that traffic is being intercepted (MITM). ` +
        `Verify the new key out-of-band (your VPS provider's console, ssh-keyscan from a trusted ` +
        `network) before rotating the pin.`,
    );
    this.name = "HostKeyMismatchError";
    this.expectedFingerprint = expectedFingerprint;
    this.presentedFingerprint = presentedFingerprint;
  }
}

/** OpenSSH-style `SHA256:<base64, no padding>` fingerprint of a raw host
 *  public-key blob (the exact bytes ssh2's hostVerifier hands us). */
export function computeHostFingerprint(rawKey: Buffer): string {
  const digest = createHash("sha256").update(rawKey).digest("base64").replace(/=+$/, "");
  return `SHA256:${digest}`;
}

/** Constant-time fingerprint comparison — these are not secrets, but there's
 *  no reason to leak timing on a security-relevant string compare either. */
function fingerprintsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Auth material for one connection. Exactly one of key/password is expected;
 *  the key is preferred and the password is a one-time bootstrap credential
 *  (used only to install our managed key, then discarded — never stored). */
export interface SshTarget {
  host: string;
  port: number;
  user: string;
  /** Decrypted OpenSSH private key (PEM). Preferred. */
  privateKey?: string;
  /** One-time password. Bootstrap only. */
  password?: string;
  /** The server row's pinned host-key fingerprint, when one exists. Passed
   *  through verbatim to `hostVerifier` — a mismatch fails closed. Null/undefined
   *  means "no pin yet" (first contact) — the connection is accepted on trust
   *  and the observed fingerprint comes back on `SshSession.hostFingerprint`
   *  for the caller to pin. */
  expectedFingerprint?: string | null;
}

export interface RemoteExecResult {
  exitCode: number;
  /** Combined stdout+stderr, for the failure diagnostic tail. */
  output: string;
}

export type LineSink = (line: string) => void;

/** ssh2 surfaces the failure kind on `err.level`; translate the common ones to
 *  operator-actionable messages instead of leaking library internals. A
 *  rejected `hostVerifier` surfaces as `level: "handshake"` with ssh2's own
 *  "Host denied (verification failed)" message — the caller passes the
 *  captured fingerprints so we can raise the specific, actionable error
 *  instead of the generic handshake-failure message. */
function mapConnectError(
  err: Error & { level?: string },
  hostKeyMismatch?: { expected: string; presented: string },
): Error {
  if (hostKeyMismatch) {
    return new HostKeyMismatchError(hostKeyMismatch.expected, hostKeyMismatch.presented);
  }
  switch (err.level) {
    case "client-authentication":
      return new Error(
        "SSH authentication failed — check the key is installed in the host's authorized_keys (or the password is correct).",
      );
    case "client-timeout":
      return new Error("SSH connection timed out — is the host reachable and is port open?");
    default:
      return new Error(`SSH connection failed: ${err.message}`);
  }
}

async function loadClient(): Promise<new () => SshClient> {
  let mod: typeof import("ssh2");
  try {
    mod = await import("ssh2");
  } catch {
    throw new Error(SSH2_MISSING);
  }
  return mod.Client;
}

/** A live SSH session. Reuse it across the provisioning steps, then `dispose()`. */
export class SshSession {
  /** The connected host's key fingerprint (SHA256:…), always populated on a
   *  successful connect regardless of whether a pin was enforced. Pin it via
   *  `patchServerHostFingerprint` when the caller had no prior pin. */
  readonly hostFingerprint: string;

  private constructor(
    private readonly conn: SshClient,
    hostFingerprint: string,
  ) {
    this.hostFingerprint = hostFingerprint;
  }

  static async connect(target: SshTarget): Promise<SshSession> {
    const Client = await loadClient();
    const conn = new Client();
    let presentedFingerprint = "";
    let hostKeyMismatch: { expected: string; presented: string } | undefined;
    const expected = target.expectedFingerprint;

    await new Promise<void>((resolve, reject) => {
      conn.once("ready", () => resolve());
      conn.once("error", (err: Error & { level?: string }) =>
        reject(mapConnectError(err, hostKeyMismatch)),
      );
      conn.connect({
        host: target.host,
        port: target.port,
        username: target.user,
        privateKey: target.privateKey,
        password: target.password,
        readyTimeout: 20_000,
        // Fires during the key-exchange handshake, before any auth. When
        // `expected` is set (a fingerprint is already pinned for this host)
        // a mismatch rejects the handshake outright — MITM host-key
        // substitution fails closed. When unset (first-ever contact, or a
        // pre-od-5j8.19 install that never pinned one) the key is accepted on
        // trust, same posture as Coolify's StrictHostKeyChecking=no — but
        // `presentedFingerprint` is captured either way so the caller always
        // has something to pin afterward.
        hostVerifier: (rawKey: Buffer, verify: (permitted: boolean) => void) => {
          presentedFingerprint = computeHostFingerprint(rawKey);
          if (!expected) {
            verify(true);
            return;
          }
          const ok = fingerprintsMatch(expected, presentedFingerprint);
          if (!ok) hostKeyMismatch = { expected, presented: presentedFingerprint };
          verify(ok);
        },
      });
    });
    return new SshSession(conn, presentedFingerprint);
  }

  /**
   * Run a bash script on the remote and stream its output. The script is
   * base64-piped into `bash` so we never have to escape it into a command
   * line. Resolves with the exit code even on non-zero — the caller decides
   * whether that's fatal (some probe steps expect failure).
   */
  runScript(script: string, onLine?: LineSink): Promise<RemoteExecResult> {
    const b64 = Buffer.from(script, "utf8").toString("base64");
    return this.exec(`echo ${b64} | base64 -d | bash`, onLine);
  }

  private exec(command: string, onLine?: LineSink): Promise<RemoteExecResult> {
    return new Promise((resolve, reject) => {
      this.conn.exec(command, { pty: false }, (err, stream) => {
        if (err) return reject(err);
        let output = "";
        let buf = "";
        const feed = (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          output += text;
          buf += text;
          let idx = buf.indexOf("\n");
          while (idx >= 0) {
            onLine?.(buf.slice(0, idx));
            buf = buf.slice(idx + 1);
            idx = buf.indexOf("\n");
          }
        };
        stream.on("data", feed);
        stream.stderr.on("data", feed);
        stream.on("close", (code: number | null) => {
          if (buf.length > 0) onLine?.(buf); // flush trailing partial line
          resolve({ exitCode: code ?? 0, output });
        });
      });
    });
  }

  dispose(): void {
    this.conn.end();
  }
}
