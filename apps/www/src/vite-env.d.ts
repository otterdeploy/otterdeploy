/// <reference types="vite/client" />

/**
 * Newest release tag, substituted at build time by the `define` in
 * vite.config.ts. Empty string when no tag could be resolved. Consumers must
 * treat that as "unknown" and render nothing.
 */
declare const __DOCS_VERSION__: string;

/** True only when Vite proved that the build checkout has complete Git
 * history, making per-file dates safe to publish. */
declare const __DOCS_GIT_HISTORY_COMPLETE__: boolean;

/**
 * Validated OpenAPI document captured when Vite starts, or null when the
 * configured control plane was unavailable. It is public API metadata, not a
 * credential, and is compiled into the server output for Cloudflare Workers.
 */
declare const __OPENAPI_SPEC__: import("./lib/openapi-loader").LoadedOpenAPIDocument | null;
