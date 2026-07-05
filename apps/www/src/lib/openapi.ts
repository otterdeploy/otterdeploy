import type { OpenAPIV3_2 } from "fumadocs-openapi";

import { createOpenAPI } from "fumadocs-openapi/server";

// fumadocs-openapi's input `Document` is the OpenAPI 3.2 shape; the oRPC server
// emits 3.1 and the loader upgrades it internally, so the parsed JSON is
// structurally compatible — we type the loader to the input's expected shape.
type Document = OpenAPIV3_2.Document;

// Source of truth = the server's live OpenAPI document, emitted by the oRPC
// `OpenAPIHandler` from the same Zod contracts that type the dashboard
// (apps/server/src/index.ts → prefix `/api/reference`, default `specPath`
// `/spec.json`). We never vendor a copy of the spec — it would go stale.
//
// fumadocs-openapi's bundler resolves `input` strings as file paths / $ref
// pointers (not http URLs), so we fetch the spec ourselves at build / module-
// eval time and hand it over as an already-parsed `Document`. Override the URL
// with `OTTERSTACK_OPENAPI_SPEC_URL` in prod (the deployed API); it defaults to
// the local dev server.
//
// This is a server-only build/SSR value (the spec is fetched server-side at
// module-eval time, never shipped to the browser), so `import.meta.env` is the
// wrong channel — it would inline the URL into the client bundle and require a
// `VITE_` rename. Reading `process.env` directly is correct here, the same way
// `vite.config.ts` reads `PORT`.
// oxlint-disable-next-line node/no-process-env
const envSpecUrl = process.env.OTTERSTACK_OPENAPI_SPEC_URL;
const specUrl = envSpecUrl ?? "http://localhost:3000/api/reference/spec.json";

// A structurally-valid but empty document. Used as a fallback when the live
// spec can't be fetched (e.g. the API isn't deployed/reachable in prod) so the
// reference degrades to "no operations" instead of 500-ing the whole site —
// `staticSource` runs at module-eval via a top-level await in source.ts, so a
// thrown error here takes down every route, landing page included.
const EMPTY_SPEC: Document = {
  openapi: "3.1.0",
  info: { title: "otterdeploy API", version: "0.0.0" },
  paths: {},
};

async function loadSpec(): Promise<Document> {
  try {
    const res = await fetch(specUrl);
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    // `res.json()` is `any`; assert to the loader's `Document` shape. The oRPC
    // server emits a valid OpenAPI document, validated at generation time.
    const spec: Document = await res.json();
    return spec;
  } catch (error) {
    // Don't let an unreachable/erroring spec endpoint take the site down — the
    // docs + landing must render regardless. The API reference is empty until
    // the spec is reachable (set OTTERSTACK_OPENAPI_SPEC_URL to the deployed
    // API's /api/reference/spec.json).
    console.error(`Failed to load OpenAPI spec from ${specUrl}:`, error);
    return EMPTY_SPEC;
  }
}

export const openapi = createOpenAPI({
  // Record key → the schema id; `baseDir: "openapi"` mounts pages under it.
  input: { "otterdeploy.json": loadSpec },
  // Always re-read so the reference tracks the live contracts in dev.
  disableCache: true,
});
