import * as z from "zod";

/** C0 controls (U+0000-U+001F) and DEL (U+007F): never legal in a header
 *  value. Checked by code point rather than a regex character class so the
 *  intent stays explicit without control characters in a pattern. */
const hasControlChar = (value: string): boolean => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

const headerValue = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine((value) => !hasControlChar(value), "Header values cannot contain controls.");

/**
 * Safe, declarative subset of per-route edge behavior. Every value is rendered
 * by trusted builder code; tenants never contribute Caddyfile tokens, paths,
 * matchers, upstreams, handlers, or filesystem directives.
 */
export const routePolicySchema = z
  .object({
    compression: z.enum(["off", "gzip", "zstd", "gzip-zstd"]),
    maxRequestBodyMb: z.number().int().min(1).max(100).nullable(),
    hsts: z.enum(["off", "one-year", "one-year-subdomains", "preload"]),
    contentTypeNosniff: z.boolean(),
    frameOptions: z.enum(["off", "deny", "sameorigin"]),
    referrerPolicy: z.enum([
      "off",
      "no-referrer",
      "same-origin",
      "strict-origin",
      "strict-origin-when-cross-origin",
    ]),
    contentSecurityPolicy: headerValue.nullable(),
    /**
     * How the edge dials this route's upstream.
     *
     * `h2c` renders `reverse_proxy h2c://host:port`, i.e. HTTP/2 cleartext.
     * gRPC cannot work over anything else, and Caddy's default upstream
     * transport is HTTP/1.1, so a backend speaking gRPC is unreachable
     * through the edge until this is set — the request loses HTTP/2 at the
     * edge hop, before whatever the stack does internally can matter. That is
     * exactly why NetBird's peers cannot register even though its own sidecar
     * speaks h2c (#239).
     *
     * Opt-in, and it has to be: `h2c://` speaks ONLY HTTP/2 to the upstream,
     * so turning it on for an ordinary HTTP/1.1 backend breaks that backend.
     *
     * Defaulted rather than required so every row written before this field
     * existed still parses (the jsonb column is read through
     * `routePolicySchema.safeParse`, which falls back to
     * DEFAULT_ROUTE_POLICY on failure — a strict miss here would silently
     * reset every other policy value on those rows).
     */
    upstreamProtocol: z.enum(["http", "h2c"]).default("http"),
  })
  .strict();

export type RoutePolicy = z.infer<typeof routePolicySchema>;

export const DEFAULT_ROUTE_POLICY: RoutePolicy = {
  compression: "off",
  maxRequestBodyMb: null,
  hsts: "off",
  contentTypeNosniff: false,
  frameOptions: "off",
  referrerPolicy: "off",
  contentSecurityPolicy: null,
  upstreamProtocol: "http",
};
