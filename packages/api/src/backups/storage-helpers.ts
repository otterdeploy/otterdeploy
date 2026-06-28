/**
 * Leaf helpers for backup archive storage (storage.ts): the shared string
 * coercion plus the dependency-free S3 SigV4 request signer. Extracted so
 * storage.ts stays focused on the put/get/remove dispatch + SFTP backend.
 */
import { createHash, createHmac } from "node:crypto";

import type { ResolvedDestination } from "./storage";

export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// ─── S3 SigV4 ────────────────────────────────────────────────────────────

function s3Endpoint(
  dest: ResolvedDestination,
  key: string,
): {
  url: URL;
  host: string;
} {
  const bucket = str(dest.config.bucket);
  if (!bucket) throw new Error("s3 destination missing `bucket`");
  const region = str(dest.config.region) ?? "us-east-1";
  const endpoint = str(dest.config.endpoint);
  // Path-style addressing works for both AWS and S3-compatible stores.
  const base = endpoint ? new URL(endpoint) : new URL(`https://s3.${region}.amazonaws.com`);
  const url = new URL(`${base.protocol}//${base.host}/${bucket}/${key.replace(/^\/+/, "")}`);
  return { url, host: base.host };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function s3Request(
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
    `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
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
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

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
    init.body = body as unknown as RequestInit["body"];
  }
  const res = await fetch(url, init);
  if (!res.ok && !(method === "DELETE" && res.status === 404)) {
    throw new Error(`S3 ${method} failed: ${res.status} ${await res.text()}`);
  }
  return res;
}
