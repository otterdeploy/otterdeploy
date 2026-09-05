import type { OpenAPIV3_2 } from "fumadocs-openapi";

import { createOpenAPI } from "fumadocs-openapi/server";

// Source of truth = the server's live OpenAPI document, emitted by the oRPC
// `OpenAPIHandler` from the same Zod contracts that type the dashboard
// (apps/server/src/index.ts → prefix `/api/reference`, default `specPath`
// `/spec.json`). We never vendor a copy of the spec: it would go stale.
//
// Vite fetches and validates the document in its Node process, then injects
// this build-time snapshot. That boundary is necessary because Cloudflare
// Workers prohibit fetch at module scope and expose environment bindings only
// in a request context. A missing snapshot produces no virtual operation pages;
// the authored /docs/openapi overview remains available.

export const openapi = createOpenAPI({
  // Record key → the schema id; `baseDir: "openapi"` mounts pages under it.
  // Fumadocs accepts and upgrades 3.0/3.1 documents at runtime, although its
  // public server input type exposes only the upgraded 3.2 representation.
  input: __OPENAPI_SPEC__
    ? {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- checked source; Fumadocs upgrades 3.0/3.1 at this boundary
        "otterdeploy.json": __OPENAPI_SPEC__ as OpenAPIV3_2.Document,
      }
    : undefined,
});
