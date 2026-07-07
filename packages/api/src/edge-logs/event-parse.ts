/**
 * Parse Caddy's *default-logger* lines (the operational log plane — Phase 3)
 * into an EdgeEventLine. This is the stream a global `log { output net }`
 * ships: TLS/ACME lifecycle, reverse_proxy upstream errors, config reloads —
 * everything that is NOT a per-request access log.
 *
 * Access logs are routed away before this runs (see ingest.ts `isAccessLog`),
 * so we never double-count a request here. We KEEP cert events (issuance is
 * info-level but valuable) and anything at warn/error level, and DROP
 * info-level noise (config reloads, admin-api chatter, lifecycle) so the
 * bounded event ring stays high-signal.
 */

import * as z from "zod";

import type { EdgeEventCategory, EdgeEventLevel, EdgeEventLine } from "./types";

import { normalizeHost } from "./host";

let counter = 0;

/** Cap the stored raw line — a few operational lines (e.g. "New Config JSON")
 *  are enormous; we drop those by category anyway, but guard regardless. */
const MAX_RAW = 8_000;

const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization"]);

const CaddyEventSchema = z.object({
  level: z.string().optional(),
  ts: z.union([z.number(), z.string()]).optional(),
  logger: z.string().optional(),
  msg: z.string().optional(),
  error: z.string().optional(),
  // ACME challenge errors carry the single host; cert-management batches carry
  // a `domains` array; OCSP stapling uses `identifiers`.
  host: z.string().optional(),
  domains: z.array(z.string()).optional(),
  identifiers: z.array(z.string()).optional(),
  // reverse_proxy errors carry the upstream dial + the proxied request.
  upstream: z.string().optional(),
  request: z.object({ host: z.string().optional() }).passthrough().optional(),
});

function levelOf(raw: string | undefined): EdgeEventLevel {
  if (raw === "error" || raw === "fatal" || raw === "panic") return "error";
  if (raw === "warn") return "warn";
  if (raw === "debug") return "debug";
  return "info";
}

function categorize(logger: string, msg: string): EdgeEventCategory {
  const m = msg.toLowerCase();
  if (
    logger.startsWith("tls") ||
    /challenge|certificate|\bacme\b|ocsp|obtain|renew|issuanc/.test(m)
  ) {
    return "cert";
  }
  if (logger === "http.handlers.reverse_proxy") return "upstream";
  if (logger.startsWith("admin") || logger === "docker-proxy" || /config|caddyfile/.test(m)) {
    return "config";
  }
  return "other";
}

/** Keep cert events at any level (issuance/renewal are info but matter); for
 *  everything else keep only warn/error. Drops info-level reload/admin noise. */
function shouldKeep(category: EdgeEventCategory, level: EdgeEventLevel): boolean {
  return category === "cert" || level === "warn" || level === "error";
}

function parseTs(ts: number | string | undefined): string {
  if (typeof ts === "number") return new Date(ts * 1000).toISOString();
  if (typeof ts === "string") return ts;
  return new Date(0).toISOString();
}

/** Re-serialize the line for the detail view, dropping sensitive request
 *  headers (reverse_proxy errors embed the proxied request) and capping size. */
function sanitizeRaw(raw: Record<string, unknown>): string {
  let obj: unknown = raw;
  const req = raw.request;
  if (req && typeof req === "object" && "headers" in req) {
    const headers = (req as { headers?: unknown }).headers;
    if (headers && typeof headers === "object") {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
        if (SENSITIVE_HEADERS.has(k.toLowerCase())) continue;
        cleaned[k] = v;
      }
      obj = { ...raw, request: { ...(req as object), headers: cleaned } };
    }
  }
  const str = JSON.stringify(obj);
  return str.length > MAX_RAW ? `${str.slice(0, MAX_RAW)}…` : str;
}

export function parseCaddyEvent(raw: unknown): EdgeEventLine | null {
  const result = CaddyEventSchema.safeParse(raw);
  if (!result.success) return null;

  const data = result.data;
  const logger = data.logger ?? "";
  const msg = data.msg ?? "";
  if (!logger && !msg) return null;

  const level = levelOf(data.level);
  const category = categorize(logger, msg);
  if (!shouldKeep(category, level)) return null;

  // Canonicalize host + batch domains identically to the access plane so the
  // per-tenant scope check (event-ring `inScope`/`redact`) matches the owned
  // domains — see ./host.
  const domains = (data.domains ?? data.identifiers ?? []).map(normalizeHost);
  const rawHost = data.host ?? data.request?.host ?? null;
  const host = rawHost ? normalizeHost(rawHost) : null;
  const parsedTs = parseTs(data.ts);

  return {
    id: `${parsedTs}-${counter++}`,
    ts: parsedTs,
    level,
    category,
    logger,
    msg,
    host,
    domains,
    upstream: data.upstream ?? null,
    error: data.error ?? null,
    raw: sanitizeRaw(raw as Record<string, unknown>),
  };
}
