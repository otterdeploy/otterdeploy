/// <reference types="vite/client" />

/**
 * Newest release tag, substituted at build time by the `define` in
 * vite.config.ts. Empty string when no tag could be resolved. Consumers must
 * treat that as "unknown" and render nothing.
 */
declare const __DOCS_VERSION__: string;
