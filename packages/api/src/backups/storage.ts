/**
 * Backup archive storage. Abstracts the destination types behind
 * put/get/remove so the engine doesn't branch on type. Two backends are
 * implemented:
 *   - local : write under `config.path` on the control-plane host
 *   - s3    : single-PUT to an S3-compatible bucket, signed with SigV4
 *             (no SDK dependency; works against AWS, R2, MinIO via endpoint)
 *
 * `sftp` is recognised but not yet implemented — it throws a clear error the
 * engine surfaces as a failed run rather than silently succeeding.
 */
import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type DestinationType = "s3" | "local" | "sftp";

export interface ResolvedDestination {
  type: DestinationType;
  config: Record<string, unknown>;
  /** Decrypted secret creds (empty for `local`). */
  secret: Record<string, string>;
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
    case "sftp":
      throw new Error("SFTP destinations are not supported yet");
  }
}

export async function getArchive(
  dest: ResolvedDestination,
  key: string,
): Promise<Buffer> {
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
      throw new Error("SFTP destinations are not supported yet");
  }
}

export async function removeArchive(
  dest: ResolvedDestination,
  key: string,
): Promise<void> {
  switch (dest.type) {
    case "local":
      await rm(key, { force: true });
      return;
    case "s3":
      await s3Request(dest, "DELETE", key);
      return;
    case "sftp":
      throw new Error("SFTP destinations are not supported yet");
  }
}

// ─── S3 SigV4 ────────────────────────────────────────────────────────────

function s3Endpoint(dest: ResolvedDestination, key: string): {
  url: URL;
  host: string;
} {
  const bucket = str(dest.config.bucket);
  if (!bucket) throw new Error("s3 destination missing `bucket`");
  const region = str(dest.config.region) ?? "us-east-1";
  const endpoint = str(dest.config.endpoint);
  // Path-style addressing works for both AWS and S3-compatible stores.
  const base = endpoint
    ? new URL(endpoint)
    : new URL(`https://s3.${region}.amazonaws.com`);
  const url = new URL(
    `${base.protocol}//${base.host}/${bucket}/${key.replace(/^\/+/, "")}`,
  );
  return { url, host: base.host };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

async function s3Request(
  dest: ResolvedDestination,
  method: "PUT" | "GET" | "DELETE",
  key: string,
  body?: Buffer,
): Promise<Response> {
  const accessKeyId = str(dest.secret.accessKeyId);
  const secretAccessKey = str(dest.secret.secretAccessKey);
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("s3 destination missing credentials");
  }
  const region = str(dest.config.region) ?? "us-east-1";
  const service = "s3";
  const { url, host } = s3Endpoint(dest, key);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const init: RequestInit = {
    method,
    headers: {
      Host: host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      Authorization: authorization,
      ...(body ? { "Content-Length": String(body.length) } : {}),
    },
  };
  // Only attach a body for write verbs — fetch rejects a body on GET.
  if (body && method !== "GET") {
    init.body = body as unknown as BodyInit;
  }
  const res = await fetch(url, init);
  if (!res.ok && !(method === "DELETE" && res.status === 404)) {
    throw new Error(`S3 ${method} failed: ${res.status} ${await res.text()}`);
  }
  return res;
}
