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
// oxlint-disable-next-line node/no-process-env
const specUrl =
  process.env.OTTERSTACK_OPENAPI_SPEC_URL ??
  "http://localhost:3000/api/reference/spec.json";

async function loadSpec(): Promise<Document> {
  const res = await fetch(specUrl);
  if (!res.ok) {
    throw new Error(
      `Failed to load OpenAPI spec from ${specUrl}: ${res.status} ${res.statusText}`,
    );
  }
  // `res.json()` is `any`; assert to the loader's `Document` shape. The oRPC
  // server emits a valid OpenAPI document, validated at generation time.
  const spec: Document = await res.json();
  return spec;
}

export const openapi = createOpenAPI({
  // Record key → the schema id; `baseDir: "openapi"` mounts pages under it.
  input: { "otterdeploy.json": loadSpec },
  // Always re-read so the reference tracks the live contracts in dev.
  disableCache: true,
});
