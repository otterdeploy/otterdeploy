import type { CaddyHandler } from "./types";

export function createReverseProxyHandler(
  upstream: string,
  port: number,
): CaddyHandler {
  return {
    handler: "reverse_proxy",
    upstreams: [{ dial: `${upstream}:${port}` }],
  };
}

export function createCompressionHandler(): CaddyHandler {
  return {
    handler: "encode",
    encodings: { gzip: {}, zstd: {} },
  };
}

export function createSecurityHeadersHandler(): CaddyHandler {
  return {
    handler: "headers",
    response: {
      set: {
        "X-Content-Type-Options": ["nosniff"],
        "X-Frame-Options": ["DENY"],
        "X-XSS-Protection": ["1; mode=block"],
        "Referrer-Policy": ["strict-origin-when-cross-origin"],
      },
    },
  };
}
