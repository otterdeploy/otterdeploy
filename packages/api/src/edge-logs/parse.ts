import * as z from "zod";
import type { EdgeLogLine } from "./types";

// TLS numeric codes → human strings (crypto/tls constants).
const TLS_VERSIONS: Record<number, string> = {
  769: "TLSv1.0",
  770: "TLSv1.1",
  771: "TLSv1.2",
  772: "TLSv1.3",
};

const TLS_CIPHERS: Record<number, string> = {
  4865: "TLS_AES_128_GCM_SHA256",
  4866: "TLS_AES_256_GCM_SHA384",
  4867: "TLS_CHACHA20_POLY1305_SHA256",
};

let counter = 0;

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
]);

const HeaderMapSchema = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string())]),
);

const TlsSchema = z.object({
  version: z.number().optional(),
  cipher_suite: z.number().optional(),
});

const RequestSchema = z.object({
  method: z.string(),
  host: z.string(),
  uri: z.string().optional(),
  remote_ip: z.string().optional(),
  remote_addr: z.string().optional(),
  headers: HeaderMapSchema.optional(),
  tls: TlsSchema.optional(),
});

const CaddyAccessLogSchema = z.object({
  ts: z.union([z.number(), z.string()]).optional(),
  request: RequestSchema,
  status: z.number().optional(),
  duration: z.number().optional(),
  size: z.number().optional(),
  bytes_read: z.number().optional(),
  request_id: z.string().optional(),
  resp_headers: HeaderMapSchema.optional(),
});

type HeaderMap = z.infer<typeof HeaderMapSchema>;

function firstHeader(headers: HeaderMap | undefined, name: string): string {
  if (!headers) return "";
  const v = headers[name];
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

/** Flatten Caddy's header map ({Name: [values]}) to {name: "v1, v2"},
 *  dropping sensitive headers. */
function flattenHeaders(
  headers: HeaderMap | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(k.toLowerCase())) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

function ipOf(req: z.infer<typeof RequestSchema>): string {
  if (req.remote_ip) return req.remote_ip;
  if (req.remote_addr) {
    const addr = req.remote_addr;
    const lastColon = addr.lastIndexOf(":");
    const host = lastColon > 0 ? addr.slice(0, lastColon) : addr;
    return host.replace(/^\[|\]$/g, "");
  }
  return "";
}

function parseTs(ts: number | string | undefined): string {
  if (typeof ts === "number") return new Date(ts * 1000).toISOString();
  if (typeof ts === "string") return ts;
  return new Date(0).toISOString();
}

export function parseCaddyAccessLog(raw: unknown): EdgeLogLine | null {
  const result = CaddyAccessLogSchema.safeParse(raw);
  if (!result.success) return null;

  const {
    ts,
    request: req,
    status,
    duration,
    size,
    bytes_read,
    request_id,
    resp_headers,
  } = result.data;

  const parsedTs = parseTs(ts);

  const tlsVersion =
    req.tls?.version != null
      ? (TLS_VERSIONS[req.tls.version] ?? `0x${req.tls.version.toString(16)}`)
      : null;

  const tlsCipher =
    req.tls?.cipher_suite != null
      ? (TLS_CIPHERS[req.tls.cipher_suite] ??
        `0x${req.tls.cipher_suite.toString(16)}`)
      : null;

  const referer = firstHeader(req.headers, "Referer") || "-";

  const cacheRaw =
    firstHeader(resp_headers, "Cache-Status") ||
    firstHeader(resp_headers, "X-Cache") ||
    null;

  const requestId =
    (request_id ?? null) ||
    firstHeader(resp_headers, "X-Request-Id") ||
    firstHeader(req.headers, "X-Request-Id") ||
    null;

  return {
    id: `${parsedTs}-${counter++}`,
    ts: parsedTs,
    method: req.method,
    host: req.host,
    path: req.uri ?? "/",
    status: status ?? 0,
    latencyMs: duration != null ? Math.round(duration * 1000) : 0,
    clientIp: ipOf(req),
    country: null,
    userAgent: firstHeader(req.headers, "User-Agent"),
    referer,
    tlsVersion,
    tlsCipher,
    upstream: null,
    cache: cacheRaw,
    reqBytes: bytes_read ?? 0,
    resBytes: size ?? 0,
    requestId,
    headers: flattenHeaders(req.headers),
  };
}
