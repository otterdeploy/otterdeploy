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
 */

import type { Client as SshClient } from "ssh2";

const SSH2_MISSING =
  "ssh2 is not installed — run `bun install` to enable remote server provisioning " +
  "(it's an optional dependency so single-host installs don't pay for its native build).";

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
}

export interface RemoteExecResult {
  exitCode: number;
  /** Combined stdout+stderr, for the failure diagnostic tail. */
  output: string;
}

export type LineSink = (line: string) => void;

/** ssh2 surfaces the failure kind on `err.level`; translate the common ones to
 *  operator-actionable messages instead of leaking library internals. */
function mapConnectError(err: Error & { level?: string }): Error {
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
  private constructor(private readonly conn: SshClient) {}

  static async connect(target: SshTarget): Promise<SshSession> {
    const Client = await loadClient();
    const conn = new Client();
    await new Promise<void>((resolve, reject) => {
      conn.once("ready", () => resolve());
      conn.once("error", (err: Error & { level?: string }) => reject(mapConnectError(err)));
      conn.connect({
        host: target.host,
        port: target.port,
        username: target.user,
        privateKey: target.privateKey,
        password: target.password,
        readyTimeout: 20_000,
        // First contact with a brand-new host — no known_hosts entry can exist
        // yet, so we accept the host key on trust (same as Coolify's
        // StrictHostKeyChecking=no). The tailnet path (phase 2) removes the
        // MITM window by carrying this over an authenticated mesh.
      });
    });
    return new SshSession(conn);
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
