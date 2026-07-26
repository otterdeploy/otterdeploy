/**
 * Minimal AWS Signature Version 4 request signer — just enough to PUT/GET/
 * DELETE/LIST against an S3-compatible endpoint (AWS S3, Cloudflare R2,
 * MinIO, Backblaze B2's S3 API) over plain `fetch`.
 *
 * Deliberately not `@aws-sdk/client-s3`: the SDK pulls in a large dependency
 * tree for what this needs — three object operations and one list — and the
 * rest of the audit-export module already has to be transport-agnostic (see
 * ./destination.ts) for the local/memory test destinations. SigV4 itself is
 * a fixed, well-specified algorithm; implementing it directly keeps the
 * off-host export path small and auditable.
 */
import { createHash, createHmac } from "node:crypto";

export interface Sigv4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** e.g. "s3". */
  service: string;
}

export interface Sigv4SignInput {
  method: "GET" | "PUT" | "DELETE";
  /** Full request URL, including bucket/key path and any query string. */
  url: URL;
  /** Raw body bytes, or empty for GET/DELETE. */
  body?: Uint8Array;
  /** Extra headers to sign (host + x-amz-date + x-amz-content-sha256 are
   *  added automatically). */
  headers?: Record<string, string>;
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function amzDate(now: Date): { date: string; dateTime: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { date: iso.slice(0, 8), dateTime: iso };
}

/** URI-encode a path segment the way SigV4 requires: RFC 3986, but `/`
 *  preserved in the canonical URI (each segment encoded, joined by `/`). */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalUri(pathname: string): string {
  return pathname.split("/").map(encodeSegment).join("/");
}

function canonicalQuery(url: URL): string {
  const params = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return params
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/**
 * Sign one request and return the headers to attach (including
 * `Authorization`). Caller performs the actual `fetch`.
 */
export function signRequest(
  creds: Sigv4Credentials,
  input: Sigv4SignInput,
  now: Date = new Date(),
): Record<string, string> {
  const { date, dateTime } = amzDate(now);
  const body = input.body ?? new Uint8Array(0);
  const payloadHash = sha256Hex(body);
  const host = input.url.host;

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": dateTime,
    ...input.headers,
  };
  const signedHeaderNames = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h] ?? ""}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    input.method,
    canonicalUri(input.url.pathname),
    canonicalQuery(input.url),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${date}/${creds.region}/${creds.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    dateTime,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${creds.secretAccessKey}`, date);
  const kRegion = hmac(kDate, creds.region);
  const kService = hmac(kRegion, creds.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": dateTime,
    Authorization: authorization,
    ...input.headers,
  };
}
