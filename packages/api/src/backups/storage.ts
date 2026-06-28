import { omitUndefined } from "@otterdeploy/shared/object";
/**
 * Backup archive storage. Abstracts the destination types behind
 * put/get/remove so the engine doesn't branch on type. Three backends are
 * implemented:
 *   - local : write under `config.path` on the control-plane host
 *   - s3    : single-PUT to an S3-compatible bucket, signed with SigV4
 *             (no SDK dependency; works against AWS, R2, MinIO via endpoint)
 *   - sftp  : upload/download/delete over SSH to a remote path, via
 *             `ssh2-sftp-client` (loaded lazily so an absent install only
 *             fails sftp runs, never local/s3). Keys are laid out under
 *             `config.basePath` exactly like the s3 key layout.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";

import { s3Request, str } from "./storage-helpers";

export type DestinationType = "s3" | "local" | "sftp";

export interface ResolvedDestination {
  type: DestinationType;
  config: Record<string, unknown>;
  /** Decrypted secret creds (empty for `local`). */
  secret: Record<string, string>;
}

/** Build the storage key/path for a backup archive (without the local root). */
export function archiveKey(input: {
  prefix?: string;
  resourceId: string;
  backupId: string;
  ext: string;
}): string {
  const parts = [
    input.prefix?.replace(/^\/+|\/+$/g, ""),
    "otterdeploy-backups",
    input.resourceId,
    `${input.backupId}.${input.ext}`,
  ].filter(Boolean);
  return parts.join("/");
}

export async function putArchive(
  dest: ResolvedDestination,
  key: string,
  body: Buffer,
): Promise<{ storagePath: string }> {
  switch (dest.type) {
    case "local": {
      const root = str(dest.config.path);
      if (!root) throw new Error("local destination missing `path`");
      const full = resolve(join(root, key));
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, body);
      return { storagePath: full };
    }
    case "s3": {
      await s3Request(dest, "PUT", key, body);
      return { storagePath: key };
    }
    case "sftp": {
      await withSftp(dest, async (client, p) => {
        const remote = sftpRemotePath(p.basePath, key);
        const dir = posix.dirname(remote);
        if (dir && dir !== "." && dir !== "/") {
          await client
            .mkdir(dir, true)
            .catch((cause: unknown) => sftpThrow(`mkdir ${dir}`, p, cause));
        }
        await client
          .put(body, remote)
          .catch((cause: unknown) => sftpThrow(`upload ${remote}`, p, cause));
      });
      return { storagePath: key };
    }
  }
}

export async function getArchive(dest: ResolvedDestination, key: string): Promise<Buffer> {
  switch (dest.type) {
    case "local": {
      const root = str(dest.config.path);
      if (!root) throw new Error("local destination missing `path`");
      // `key` is already the absolute storagePath for local.
      return readFile(key.startsWith("/") ? key : resolve(join(root, key)));
    }
    case "s3": {
      const res = await s3Request(dest, "GET", key);
      return Buffer.from(await res.arrayBuffer());
    }
    case "sftp":
      return withSftp(dest, async (client, p) => {
        const remote = sftpRemotePath(p.basePath, key);
        const out = await client
          .get(remote)
          .catch((cause: unknown) => sftpThrow(`download ${remote}`, p, cause));
        // `get` with no dst resolves to a Buffer; normalise defensively.
        return Buffer.isBuffer(out) ? out : Buffer.from(out as Uint8Array);
      });
  }
}

export async function removeArchive(dest: ResolvedDestination, key: string): Promise<void> {
  switch (dest.type) {
    case "local":
      await rm(key, { force: true });
      return;
    case "s3":
      await s3Request(dest, "DELETE", key);
      return;
    case "sftp":
      await withSftp(dest, async (client, p) => {
        const remote = sftpRemotePath(p.basePath, key);
        // `noErrorOK = true` → deleting an already-gone archive is a no-op
        // (matches s3's 404-tolerant DELETE).
        await client
          .delete(remote, true)
          .catch((cause: unknown) => sftpThrow(`delete ${remote}`, p, cause));
      });
      return;
  }
}

// ─── SFTP ────────────────────────────────────────────────────────────────

/** The slice of `ssh2-sftp-client` we use. Declared locally so the package is a
 *  pure runtime dependency — neither the typecheck nor module load of this file
 *  depends on it being installed (it's loaded lazily below). */
interface SftpClientLike {
  connect(cfg: Record<string, unknown>): Promise<unknown>;
  put(input: Buffer, remotePath: string): Promise<string>;
  get(remotePath: string): Promise<Buffer | Uint8Array | string>;
  delete(remotePath: string, noErrorOK?: boolean): Promise<string>;
  mkdir(remotePath: string, recursive?: boolean): Promise<string>;
  end(): Promise<void>;
}

interface SftpParams {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  /** Remote base dir the key layout is rooted at (default `.` = login dir). */
  basePath: string;
}

/** Validate + assemble the SFTP connection params from the destination's
 *  `config` (host/port/basePath) and decrypted `secret` (username + auth). */
function sftpParams(dest: ResolvedDestination): SftpParams {
  const host = str(dest.config.host);
  if (!host) throw new Error("sftp destination missing `host`");
  const username = str(dest.secret.username) ?? str(dest.config.username);
  if (!username) throw new Error("sftp destination missing `username`");
  const password = str(dest.secret.password);
  const privateKey = str(dest.secret.privateKey);
  if (!password && !privateKey) {
    throw new Error("sftp destination missing credentials (password or privateKey)");
  }
  const rawPort = dest.config.port;
  const port =
    typeof rawPort === "number" ? rawPort : Number.parseInt(str(rawPort) ?? "", 10) || 22;
  const basePath = str(dest.config.basePath) ?? str(dest.config.path) ?? ".";
  return {
    host,
    port,
    username,
    password,
    privateKey,
    passphrase: str(dest.secret.passphrase),
    basePath,
  };
}

/** Remote path for a storage key under the destination's base dir. POSIX
 *  joins (SFTP paths are always `/`-separated), key leading-slashes stripped. */
export function sftpRemotePath(basePath: string, key: string): string {
  return posix.join(basePath, key.replace(/^\/+/, ""));
}

/** Wrap an operation message + cause into one clear, surfaced error. */
function sftpThrow(op: string, p: SftpParams, cause: unknown): never {
  const detail = cause instanceof Error ? cause.message : String(cause);
  throw new Error(`SFTP ${op} on ${p.host}:${p.port} failed: ${detail}`);
}

/** Lazily load `ssh2-sftp-client`. Kept out of the module's import graph so an
 *  absent install fails ONLY sftp runs (with an actionable message), never the
 *  local/s3 paths or this module's load. */
async function loadSftpClient(): Promise<new () => SftpClientLike> {
  try {
    const mod = (await import("ssh2-sftp-client")) as unknown as {
      default?: new () => SftpClientLike;
    };
    const Ctor = mod.default ?? (mod as unknown as new () => SftpClientLike);
    if (typeof Ctor !== "function") throw new Error("no default export");
    return Ctor;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `SFTP support requires the \`ssh2-sftp-client\` package — run \`bun install\` (${detail})`,
    );
  }
}

/** Connect, run `fn`, and ALWAYS close the connection (mirrors the s3 path's
 *  credential cleanup / docker logout idiom). Connect failures get a clear
 *  host:port message. */
async function withSftp<T>(
  dest: ResolvedDestination,
  fn: (client: SftpClientLike, p: SftpParams) => Promise<T>,
): Promise<T> {
  const p = sftpParams(dest);
  const Client = await loadSftpClient();
  const client = new Client();
  try {
    await client
      .connect(
        omitUndefined({
          host: p.host,
          port: p.port,
          username: p.username,
          readyTimeout: 20_000,
          password: p.password,
          privateKey: p.privateKey,
          passphrase: p.passphrase,
        }),
      )
      .catch((cause: unknown) => sftpThrow("connect", p, cause));
    return await fn(client, p);
  } finally {
    await client.end().catch(() => undefined);
  }
}
