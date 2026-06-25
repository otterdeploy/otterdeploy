/**
 * Backup archive storage. Abstracts the destination types behind
 * put/get/remove so callers don't branch on type. Built on files-sdk — one
 * `Files` handle per destination, three backends:
 *
 *   - local → files-sdk/fs      (root = config.path; pure node:fs, auto-mkdir)
 *   - s3    → files-sdk/bun-s3   (Bun.S3Client natively — NO @aws-sdk)
 *   - sftp  → files-sdk/sftp     (host/port/username/auth + root = basePath)
 *
 * `bun-s3` drives Bun's built-in S3 client, so S3 stays SDK-free without any
 * hand-rolled SigV4. `fs` and `bun-s3` pull nothing native; the only optional
 * dep is `ssh2-sftp-client` for the sftp backend — lazy-imported below so an
 * absent (optional) install only fails sftp runs, never local/s3 or this
 * module's load.
 *
 * Errors are values, not exceptions: every operation returns a
 * `Result<_, StorageError>`. Config validation, the lazy sftp import, and the
 * underlying files-sdk calls all surface as a `StorageError` — files-sdk
 * rejections are captured via `Result.tryPromise`, so there is no raw
 * try/catch anywhere in this module.
 */
import { Result, TaggedError } from "better-result";
import { Files } from "files-sdk";
import { bunS3 } from "files-sdk/bun-s3";
import { fs } from "files-sdk/fs";

export type DestinationType = "s3" | "local" | "sftp";

export interface ResolvedDestination {
  type: DestinationType;
  config: Record<string, unknown>;
  /** Decrypted secret creds (empty for `local`). */
  secret: Record<string, string>;
}

/** Which storage operation failed. `config` covers validation + the optional
 *  sftp-dependency load (everything before the first byte moves). */
export type StorageOp = "config" | "put" | "get" | "remove";

/** The single error every storage operation can fail with. Carries the failing
 *  op, the destination type, and the underlying cause (an S3 4xx, an ssh2
 *  connect failure, a missing optional dep, ...). */
export class StorageError extends TaggedError("StorageError")<{
  message: string;
  op: StorageOp;
  destType: DestinationType;
  cause: unknown;
}>() {
  constructor(args: {
    op: StorageOp;
    destType: DestinationType;
    reason: string;
    cause?: unknown;
  }) {
    super({
      op: args.op,
      destType: args.destType,
      cause: args.cause,
      message:
        args.cause == null
          ? args.reason
          : `${args.reason}: ${causeMessage(args.cause)}`,
    });
  }
}

/** Best-effort human message for a thrown cause (Error message, else String). */
function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
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

/** `Result.err` for a config/validation failure (before any bytes move). */
function configErr(destType: DestinationType, reason: string) {
  return Result.err(new StorageError({ op: "config", destType, reason }));
}

/** Construct a `Files` handle inside a Result. files-sdk's adapter factories
 *  (`fs()`/`bunS3()`/`sftp()`) can throw `FilesError` synchronously on bad
 *  input, so wrapping in `Result.try` keeps a construction failure a
 *  `StorageError` value rather than an exception (and, inside a `.map`/`.andThen`
 *  chain, an unrecoverable Panic). */
function safeFiles(
  destType: DestinationType,
  make: () => Files,
): Result<Files, StorageError> {
  return Result.try({
    try: make,
    catch: (cause) =>
      new StorageError({
        op: "config",
        destType,
        reason: `failed to construct ${destType} adapter`,
        cause,
      }),
  });
}

/** Build a `Files` handle for the destination, or a `StorageError` if config
 *  is invalid / the optional sftp dep is missing. One factory replaces the
 *  per-verb `switch (dest.type)` the hand-rolled version repeated three times.
 *  Adapter-specific `Files` instances widen to `Files` since the generic is
 *  covariant (the adapter only ever appears in output position). */
async function filesFor(
  dest: ResolvedDestination,
): Promise<Result<Files, StorageError>> {
  switch (dest.type) {
    case "local": {
      const root = str(dest.config.path);
      if (!root) return configErr("local", "local destination missing `path`");
      return safeFiles("local", () => new Files({ adapter: fs({ root }) }));
    }
    case "s3": {
      const bucket = str(dest.config.bucket);
      if (!bucket) return configErr("s3", "s3 destination missing `bucket`");
      const accessKeyId = str(dest.secret.accessKeyId);
      const secretAccessKey = str(dest.secret.secretAccessKey);
      if (!accessKeyId || !secretAccessKey) {
        return configErr("s3", "s3 destination missing credentials");
      }
      const endpoint = str(dest.config.endpoint);
      return safeFiles(
        "s3",
        () =>
          new Files({
            adapter: bunS3({
              bucket,
              region: str(dest.config.region) ?? "us-east-1",
              ...(endpoint ? { endpoint } : {}),
              // Bun's S3 client defaults to path-style (virtualHostedStyle:false).
              // Creds passed explicitly (we decrypt them ourselves) rather than
              // via Bun's S3_*/AWS_* env resolution.
              accessKeyId,
              secretAccessKey,
            }),
          }),
      );
    }
    case "sftp": {
      return sftpParams(dest).andThenAsync(async (p) => {
        // files-sdk/sftp statically imports `ssh2-sftp-client`, so it's loaded
        // lazily — an absent optional install fails ONLY sftp runs (with an
        // actionable message), never local/s3 or this module's load.
        const mod = await Result.tryPromise({
          try: () => import("files-sdk/sftp"),
          catch: (cause) =>
            new StorageError({
              op: "config",
              destType: "sftp",
              reason:
                "SFTP support requires the `ssh2-sftp-client` package — run `bun install`",
              cause,
            }),
        });
        return mod.andThen(({ sftp }) =>
          safeFiles(
            "sftp",
            () =>
              new Files({
                adapter: sftp({
                  host: p.host,
                  port: p.port,
                  username: p.username,
                  ...(p.password ? { password: p.password } : {}),
                  ...(p.privateKey
                    ? { privateKey: p.privateKey, passphrase: p.passphrase }
                    : {}),
                  root: p.basePath,
                  readyTimeout: 20_000,
                }),
              }),
          ),
        );
      });
    }
  }
}

// ─── put / get / remove ──────────────────────────────────────────────────

export async function putArchive(
  dest: ResolvedDestination,
  key: string,
  body: Buffer,
): Promise<Result<{ storagePath: string }, StorageError>> {
  const handle = await filesFor(dest);
  return handle.andThenAsync((files) =>
    Result.tryPromise({
      try: () => files.upload(key, body),
      catch: (cause) =>
        new StorageError({
          op: "put",
          destType: dest.type,
          reason: `put ${key}`,
          cause,
        }),
      // NOTE: storagePath is the RELATIVE key for every backend, including
      // local — the old hand-rolled code stored the absolute filesystem path
      // for `local`. Existing local backups need a one-time storagePath migration.
    }).then((r) => r.map(() => ({ storagePath: key }))),
  );
}

export async function getArchive(
  dest: ResolvedDestination,
  key: string,
): Promise<Result<Buffer, StorageError>> {
  const handle = await filesFor(dest);
  return handle.andThenAsync((files) =>
    Result.tryPromise({
      try: async () => {
        const file = await files.download(key);
        return Buffer.from(await file.arrayBuffer());
      },
      catch: (cause) =>
        new StorageError({
          op: "get",
          destType: dest.type,
          reason: `get ${key}`,
          cause,
        }),
    }),
  );
}

export async function removeArchive(
  dest: ResolvedDestination,
  key: string,
): Promise<Result<void, StorageError>> {
  const handle = await filesFor(dest);
  return handle.andThenAsync((files) =>
    Result.tryPromise({
      try: () => files.delete(key),
      catch: (cause) =>
        new StorageError({
          op: "remove",
          destType: dest.type,
          reason: `remove ${key}`,
          cause,
        }),
    }),
  );
}

interface SftpParams {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  basePath: string;
}

function sftpParams(
  dest: ResolvedDestination,
): Result<SftpParams, StorageError> {
  const host = str(dest.config.host);
  if (!host) return configErr("sftp", "sftp destination missing `host`");
  const username = str(dest.secret.username) ?? str(dest.config.username);
  if (!username)
    return configErr("sftp", "sftp destination missing `username`");
  const password = str(dest.secret.password);
  const privateKey = str(dest.secret.privateKey);
  if (!password && !privateKey) {
    return configErr(
      "sftp",
      "sftp destination missing credentials (password or privateKey)",
    );
  }
  const rawPort = dest.config.port;
  const port =
    typeof rawPort === "number"
      ? rawPort
      : Number.parseInt(str(rawPort) ?? "", 10) || 22;
  const basePath = str(dest.config.basePath) ?? str(dest.config.path) ?? ".";
  return Result.ok({
    host,
    port,
    username,
    password,
    privateKey,
    passphrase: str(dest.secret.passphrase),
    basePath,
  });
}
