/**
 * Backend mapping for the rustic backup engine. Translates a `ResolvedDestination`
 * (the decrypted `{type, config, secret}` shape the engine already resolves —
 * see engine-helpers.resolveSecret) into the repository URL + OpenDAL backend
 * options rustic needs, and derives the per-(resource × destination) repo id
 * that scopes each repo and keys its password.
 *
 * rustic takes NO `-o`/`--option` flag — backend options are delivered through a
 * config profile TOML (see rustic.ts). This module only computes the option map;
 * profile generation + invocation live in `RusticCli`.
 *
 *   local : plain filesystem path        `<config.path>/<repoId>`
 *   s3    : OpenDAL s3   `opendal:s3`     options = { bucket, root, region?, endpoint?, access_key_id, secret_access_key }
 *   sftp  : OpenDAL sftp `opendal:sftp`   options = { user, endpoint:"ssh://host:port", root }
 *
 * ⚠️ SFTP is KEY-AUTH ONLY: rustic's OpenDAL sftp backend cannot authenticate
 * with a password. A password-only destination fails fast here (documented
 * limitation — a first-class SSH-key destination field is the follow-up).
 *
 * The `ResolvedDestination`/`DestinationType` shapes live here (formerly in the
 * now-deleted storage.ts, which held the pre-rustic archive-transfer layer). It
 * is the decrypted destination the whole backup subsystem passes around.
 */
import type { ExecutionContext } from "./db";

import { volumeArchiveScope } from "./volume";

/** Supported backup destination backends. */
export type DestinationType = "s3" | "local" | "sftp";

/**
 * A backup destination with its secret already decrypted — the input every
 * backend mapping consumes. `config` is the non-secret connection params
 * (bucket/region/endpoint/prefix for s3, `path` for local, host/port for sftp);
 * `secret` is the decrypted creds (empty for `local`). Produced by the engine
 * from the destination row via `engine-helpers.resolveSecret`.
 */
export interface ResolvedDestination {
  type: DestinationType;
  config: Record<string, unknown>;
  /** Decrypted secret creds (empty for `local`). */
  secret: Record<string, string>;
}

/** Coerce an unknown to a non-empty string, or `undefined`. */
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** A rustic repository target: its URL, backend options, and the id that both
 *  scopes the repo (root path) and derives its encryption password. */
export type RusticRepo = {
  repoId: string;
  repository: string;
  options: Record<string, string>;
};

/**
 * Storage-scope segment for a run — the same value `engine.archiveShape` uses:
 * a database resource is scoped by its `resourceId`, a named volume by
 * `volume-<name>`. This is the leaf a repo id is rooted at.
 */
export function repoScope(ctx: ExecutionContext): string {
  return ctx.kind === "volume" ? volumeArchiveScope(ctx.volumeName) : ctx.resourceId;
}

/**
 * Derive the repo id for a run: `[<config.prefix>/]otterdeploy-backups/<scope>`.
 * This is the old archive-key layout minus the per-run file leaf — one repo per
 * (resource × destination), rooted under the destination's optional prefix. It
 * is used as the repository root (local path / OpenDAL `root`) AND as the HKDF
 * `info` that derives the repo password, so it must be stable for a given
 * source+destination.
 */
export function deriveRepoId(ctx: ExecutionContext): string {
  const prefix =
    typeof ctx.destination.config.prefix === "string"
      ? ctx.destination.config.prefix.replace(/^\/+|\/+$/g, "")
      : undefined;
  return [prefix, "otterdeploy-backups", repoScope(ctx)].filter(Boolean).join("/");
}

/**
 * Map a resolved destination + repo id to the rustic repository URL and OpenDAL
 * options. Throws with an actionable message when required config/creds are
 * missing, or when an sftp destination lacks an SSH key (key-auth only).
 */
export function toRusticRepo(dest: ResolvedDestination, repoId: string): RusticRepo {
  switch (dest.type) {
    case "local": {
      const path = str(dest.config.path);
      if (!path) throw new Error("local destination missing `path`");
      return { repoId, repository: `${path.replace(/\/+$/, "")}/${repoId}`, options: {} };
    }
    case "s3": {
      const bucket = str(dest.config.bucket);
      if (!bucket) throw new Error("s3 destination missing `bucket`");
      const accessKeyId = str(dest.secret.accessKeyId);
      const secretAccessKey = str(dest.secret.secretAccessKey);
      if (!accessKeyId || !secretAccessKey) {
        throw new Error("s3 destination missing credentials");
      }
      const options: Record<string, string> = {
        bucket,
        root: repoId,
        access_key_id: accessKeyId,
        secret_access_key: secretAccessKey,
      };
      const region = str(dest.config.region);
      if (region) options.region = region;
      const endpoint = str(dest.config.endpoint);
      if (endpoint) options.endpoint = endpoint;
      return { repoId, repository: "opendal:s3", options };
    }
    case "sftp": {
      const host = str(dest.config.host);
      if (!host) throw new Error("sftp destination missing `host`");
      const user = str(dest.secret.username) ?? str(dest.config.username);
      if (!user) throw new Error("sftp destination missing `username`");
      const privateKey = str(dest.secret.privateKey);
      if (!privateKey) {
        // rustic's OpenDAL sftp backend authenticates with an SSH key only —
        // password auth is not supported. Fail fast with a clear message.
        const password = str(dest.secret.password);
        throw new Error(
          password
            ? "sftp destination uses password auth, which rustic's SFTP backend does not support — configure an SSH private key instead"
            : "sftp destination missing an SSH private key (rustic's SFTP backend is key-auth only)",
        );
      }
      const rawPort = dest.config.port;
      const port =
        typeof rawPort === "number"
          ? rawPort
          : Number.parseInt(str(rawPort) ?? "", 10) || 22;
      return {
        repoId,
        repository: "opendal:sftp",
        options: { user, endpoint: `ssh://${host}:${port}`, root: repoId },
      };
    }
  }
}
