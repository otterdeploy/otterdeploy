/**
 * Backend mapping for the rustic backup engine. Translates a `ResolvedDestination`
 * (the decrypted `{type, config, secret}` shape the engine already resolves -
 * see engine-helpers.resolveSecret) into the repository URL + OpenDAL backend
 * options rustic needs, and derives the per-(resource × destination) repo key
 * (on-disk repo id + the HKDF domain its password derives from).
 *
 * rustic takes NO `-o`/`--option` flag: backend options are delivered through a
 * config profile TOML (see rustic.ts). This module only computes the option map;
 * profile generation + invocation live in `RusticCli`.
 *
 *   local : plain filesystem path        `<config.path>/<repoId>`
 *   s3    : OpenDAL s3   `opendal:s3`     options = { bucket, root, region?, endpoint?, access_key_id, secret_access_key }
 *   sftp  : OpenDAL sftp `opendal:sftp`   options = { user, endpoint:"ssh://host:port", root }
 *
 * ⚠️ SFTP is KEY-AUTH ONLY: rustic's OpenDAL sftp backend cannot authenticate
 * with a password. A password-only destination fails fast here (documented
 * limitation: a first-class SSH-key destination field is the follow-up).
 *
 * The `ResolvedDestination`/`DestinationType` shapes live here (formerly in the
 * now-deleted storage.ts, which held the pre-rustic archive-transfer layer). It
 * is the decrypted destination the whole backup subsystem passes around.
 */
import type { JsonObject } from "@otterdeploy/shared/json";

import { volumeArchiveScope } from "./volume";

/** Supported backup destination backends. `azblob` (Azure Blob) and `gcs`
 *  (Google Cloud Storage) ride the same OpenDAL layer as s3/sftp. */
export type DestinationType = "s3" | "local" | "sftp" | "azblob" | "gcs";

/**
 * A backup destination with its secret already decrypted: the input every
 * backend mapping consumes. `config` is the non-secret connection params
 * (bucket/region/endpoint/prefix for s3, `path` for local, host/port for sftp);
 * `secret` is the decrypted creds (empty for `local`). Produced by the engine
 * from the destination row via `engine-helpers.resolveSecret`.
 */
export interface ResolvedDestination {
  type: DestinationType;
  config: JsonObject;
  /** Decrypted secret creds (empty for `local`). */
  secret: Record<string, string>;
}

/** Coerce an unknown to a non-empty string, or `undefined`. */
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** A rustic repository target: its URL, backend options, and the key that
 *  scopes the repo on disk and derives its encryption password. */
export interface RusticRepo extends RepoKey {
  repository: string;
  options: Record<string, string>;
}

/** The minimal source slice `repoScope` reads. `ExecutionContext` is a
 *  structural superset, so engine/restore/scheduler callers pass their ctx
 *  unchanged; tests build this narrow shape directly. */
export type RepoScopeSource =
  | { kind: "database" | "stack"; resourceId: string }
  | { kind: "volume"; volumeName: string };

/** `repoScope` plus the org + destination fields `deriveRepoKey` needs. */
export type RepoIdSource = RepoScopeSource & {
  organizationId: string;
  destination: { config: JsonObject; managed: boolean };
};

/**
 * A repo's two-part identity. `repoId` is the ON-DISK location (repository root
 * under the destination: local path suffix / OpenDAL `root`); `passwordDomain`
 * is the HKDF `info` its encryption password derives from. They are the same
 * string for external destinations; managed repos org-qualify the domain
 * because their bare-scope `repoId` is only unique per org (the org lives in
 * the path root, and a volume scope like `volume-pgdata` can repeat across
 * orgs: same password otherwise). Both must be stable for a given
 * source+destination.
 */
export interface RepoKey {
  repoId: string;
  passwordDomain: string;
}

/**
 * Storage-scope segment for a run: the same value `engine.archiveShape` uses:
 * a database resource is scoped by its `resourceId`, a named volume by
 * `volume-<name>`. This is the leaf a repo id is rooted at.
 */
export function repoScope(ctx: RepoScopeSource): string {
  return ctx.kind === "volume" ? volumeArchiveScope(ctx.volumeName) : ctx.resourceId;
}

/**
 * Derive the repo key for a run: one repo per (resource × destination).
 *
 * Platform-managed local destination: `repoId` is the bare `<scope>`. Its
 * `config.path` is already the org's repo root (`orgs/<org>/backups/`: see
 * managed-destination.ts), so the org namespace is the path itself, not a
 * prefix, and the repo lands at `orgs/<org>/backups/<scope>`. The password
 * domain is `<orgId>/<scope>`: org-qualified so two orgs' same-named volume
 * repos never share a password (see RepoKey).
 *
 * External destinations (s3 / sftp / user-supplied local): both parts are
 * `[<config.prefix>/]otterdeploy-backups/<scope>`, rooted under the
 * destination's optional prefix.
 */
export function deriveRepoKey(ctx: RepoIdSource): RepoKey {
  const scope = repoScope(ctx);
  if (ctx.destination.managed) {
    return { repoId: scope, passwordDomain: `${ctx.organizationId}/${scope}` };
  }
  const prefix =
    typeof ctx.destination.config.prefix === "string"
      ? ctx.destination.config.prefix.replace(/^\/+|\/+$/g, "")
      : undefined;
  const repoId = [prefix, "otterdeploy-backups", scope].filter(Boolean).join("/");
  return { repoId, passwordDomain: repoId };
}

/**
 * Repo key for the destination's live-probe repository (the "Test" button):
 * a real rustic repo at a reserved `.probe` scope, so a test performs a
 * genuine write-read round trip (init writes config/keys, check reads them
 * back) against the actual backend with the actual credentials. A few KB,
 * idempotent, reused by subsequent tests.
 */
export function deriveProbeRepoKey(
  organizationId: string,
  destination: { config: JsonObject; managed: boolean },
): RepoKey {
  return deriveRepoKey({
    kind: "volume",
    volumeName: ".probe",
    organizationId,
    destination,
  });
}

function localRepo(dest: ResolvedDestination, key: RepoKey): RusticRepo {
  const path = str(dest.config.path);
  if (!path) throw new Error("local destination missing `path`");
  return { ...key, repository: `${path.replace(/\/+$/, "")}/${key.repoId}`, options: {} };
}

function s3Repo(dest: ResolvedDestination, key: RepoKey): RusticRepo {
  const bucket = str(dest.config.bucket);
  if (!bucket) throw new Error("s3 destination missing `bucket`");
  const accessKeyId = str(dest.secret.accessKeyId);
  const secretAccessKey = str(dest.secret.secretAccessKey);
  if (!accessKeyId || !secretAccessKey) throw new Error("s3 destination missing credentials");
  const options: Record<string, string> = {
    bucket,
    root: key.repoId,
    access_key_id: accessKeyId,
    secret_access_key: secretAccessKey,
  };
  const region = str(dest.config.region);
  if (region) options.region = region;
  const endpoint = str(dest.config.endpoint);
  if (endpoint) options.endpoint = endpoint;
  return { ...key, repository: "opendal:s3", options };
}

function sftpRepo(dest: ResolvedDestination, key: RepoKey): RusticRepo {
  const host = str(dest.config.host);
  if (!host) throw new Error("sftp destination missing `host`");
  const user = str(dest.secret.username) ?? str(dest.config.username);
  if (!user) throw new Error("sftp destination missing `username`");
  // rustic's OpenDAL sftp backend authenticates with an SSH key only: password
  // auth is not supported. Fail fast with a clear message.
  const privateKey = str(dest.secret.privateKey);
  if (!privateKey) {
    throw new Error(
      str(dest.secret.password)
        ? "sftp destination uses password auth, which rustic's SFTP backend does not support: configure an SSH private key instead"
        : "sftp destination missing an SSH private key (rustic's SFTP backend is key-auth only)",
    );
  }
  const rawPort = dest.config.port;
  const port =
    typeof rawPort === "number" ? rawPort : Number.parseInt(str(rawPort) ?? "", 10) || 22;
  return {
    ...key,
    repository: "opendal:sftp",
    options: { user, endpoint: `ssh://${host}:${port}`, root: key.repoId },
  };
}

function azblobRepo(dest: ResolvedDestination, key: RepoKey): RusticRepo {
  const container = str(dest.config.container);
  if (!container) throw new Error("azblob destination missing `container`");
  const accountName = str(dest.secret.accountName) ?? str(dest.config.accountName);
  const accountKey = str(dest.secret.accountKey);
  if (!accountName || !accountKey) {
    throw new Error("azblob destination missing credentials (accountName + accountKey)");
  }
  const options: Record<string, string> = {
    container,
    root: key.repoId,
    account_name: accountName,
    account_key: accountKey,
    // OpenDAL azblob requires an endpoint; default to the account's public one.
    endpoint: str(dest.config.endpoint) ?? `https://${accountName}.blob.core.windows.net`,
  };
  return { ...key, repository: "opendal:azblob", options };
}

function gcsRepo(dest: ResolvedDestination, key: RepoKey): RusticRepo {
  const bucket = str(dest.config.bucket);
  if (!bucket) throw new Error("gcs destination missing `bucket`");
  // Base64-encoded service-account JSON (OpenDAL's `credential` option).
  const credential = str(dest.secret.credential);
  if (!credential) {
    throw new Error("gcs destination missing `credential` (base64 service-account JSON)");
  }
  const options: Record<string, string> = { bucket, root: key.repoId, credential };
  const endpoint = str(dest.config.endpoint);
  if (endpoint) options.endpoint = endpoint;
  return { ...key, repository: "opendal:gcs", options };
}

/**
 * Map a resolved destination + repo key to the rustic repository URL and OpenDAL
 * options. Throws with an actionable message when required config/creds are
 * missing, or when an sftp destination lacks an SSH key (key-auth only).
 */
export function toRusticRepo(dest: ResolvedDestination, key: RepoKey): RusticRepo {
  switch (dest.type) {
    case "local":
      return localRepo(dest, key);
    case "s3":
      return s3Repo(dest, key);
    case "sftp":
      return sftpRepo(dest, key);
    case "azblob":
      return azblobRepo(dest, key);
    case "gcs":
      return gcsRepo(dest, key);
  }
}
