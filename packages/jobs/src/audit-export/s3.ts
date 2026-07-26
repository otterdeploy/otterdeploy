/**
 * S3-compatible export destination (AWS S3, Cloudflare R2, MinIO, Backblaze
 * B2's S3 API) — path-style addressing (`https://<endpoint>/<bucket>/<key>`),
 * signed with the minimal SigV4 signer in ./sigv4.ts. See ./destination.ts
 * for why this doesn't go through `@aws-sdk/client-s3` or the backups
 * feature's rustic/OpenDAL machinery.
 */
import type { AuditExportDestination } from "./destination";

import { signRequest, type Sigv4Credentials } from "./sigv4";

export interface S3DestinationConfig {
  bucket: string;
  region: string;
  /** S3-compatible endpoint host (e.g. an R2/MinIO URL). Omit for real AWS
   *  S3, which is derived from `bucket` + `region`. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function objectUrl(config: S3DestinationConfig, key: string): URL {
  const base = config.endpoint
    ? new URL(config.endpoint)
    : new URL(`https://s3.${config.region}.amazonaws.com`);
  // Path-style: bucket is a path segment, not a subdomain — works uniformly
  // across AWS, R2, and MinIO without needing per-provider virtual-host DNS.
  base.pathname = `/${config.bucket}/${key}`;
  return base;
}

function bucketUrl(config: S3DestinationConfig): URL {
  const base = config.endpoint
    ? new URL(config.endpoint)
    : new URL(`https://s3.${config.region}.amazonaws.com`);
  base.pathname = `/${config.bucket}`;
  return base;
}

function creds(config: S3DestinationConfig): Sigv4Credentials {
  return {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    service: "s3",
  };
}

async function requestOrThrow(
  method: "GET" | "PUT" | "DELETE",
  url: URL,
  config: S3DestinationConfig,
  body?: Uint8Array,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const headers = signRequest(
    creds(config),
    { method, url, body, headers: extraHeaders },
    new Date(),
  );
  // `body` is a Uint8Array over an ArrayBufferLike, which this TS lib's
  // BodyInit/BlobPart won't accept; copy into a plain ArrayBuffer-backed view.
  const res = await fetch(url, {
    method,
    headers,
    body: body ? new Uint8Array(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`S3 ${method} ${url.pathname} failed: ${res.status} ${text.slice(0, 500)}`);
  }
  return res;
}

/** Extract `<Key>...</Key>` values from a ListObjectsV2 XML response body
 *  without pulling in an XML parser dependency — the response shape is
 *  fixed and flat enough that this is reliable. */
function parseListObjectKeys(xml: string): string[] {
  const keys: string[] = [];
  const re = /<Key>([^<]*)<\/Key>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    keys.push(
      match[1]
        ?.replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'") ?? "",
    );
  }
  return keys;
}

export function createS3ExportDestination(config: S3DestinationConfig): AuditExportDestination {
  return {
    kind: "s3",
    async putObject(key, body) {
      const bytes = new TextEncoder().encode(body);
      await requestOrThrow("PUT", objectUrl(config, key), config, bytes, {
        "content-type": "application/x-ndjson",
      });
    },
    async listKeys(prefix) {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      do {
        const url = bucketUrl(config);
        url.searchParams.set("list-type", "2");
        url.searchParams.set("prefix", prefix);
        if (continuationToken) url.searchParams.set("continuation-token", continuationToken);
        const res = await requestOrThrow("GET", url, config);
        const xml = await res.text();
        keys.push(...parseListObjectKeys(xml));
        const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
        const tokenMatch = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
        continuationToken = truncated ? tokenMatch?.[1] : undefined;
      } while (continuationToken);
      return keys.sort();
    },
    async deleteObject(key) {
      await requestOrThrow("DELETE", objectUrl(config, key), config);
    },
  };
}
