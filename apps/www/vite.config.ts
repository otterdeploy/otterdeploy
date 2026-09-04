import type { OpenAPIV3_2 } from "fumadocs-openapi";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { createOpenAPI } from "fumadocs-openapi/server";
import { nitro } from "nitro/vite";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// oxlint-disable-next-line vite-plus/prefer-vite-plus-imports -- plugin types share Vite's ConfigEnv, while Vite+'s duplicate type graph does not
import { defineConfig, loadEnv } from "vite";

import { captureOpenAPISpec, resolveOpenAPISpecEnvironment } from "./src/lib/openapi-loader";
import { OPENAPI_PAGE_OPTIONS } from "./src/lib/openapi-pages";

const ROOT_ENV_DIR = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The version shown in the docs sidebar, resolved once at build time.
 *
 * Order: an explicit `OTTERDEPLOY_DOCS_VERSION` (what CI sets from the tag it
 * is building), then the newest local git tag. Empty string when neither is
 * available: the sidebar row hides itself rather than print a number that
 * might be wrong, which is exactly how it drifted to a hardcoded `v0.1.0` while
 * releases had reached v0.7.0.
 */
function docsVersion(): string {
  // oxlint-disable-next-line node/no-process-env
  const pinned = process.env.OTTERDEPLOY_DOCS_VERSION;
  if (pinned) return pinned;
  try {
    return execSync("git describe --tags --abbrev=0", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

/** A shallow repository makes `git log -- <file>` report the checkout boundary
 * as if it were each unchanged file's last commit. Consumers must suppress
 * those dates unless this build can prove that the history is complete. */
function hasCompleteGitHistory(): boolean {
  try {
    return (
      execSync("git rev-parse --is-shallow-repository", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() === "false"
    );
  } catch {
    return false;
  }
}

async function docsOpenAPISpec(environment: "development" | "production", mode: string) {
  // Environment variables are intentionally read while Vite runs in Node.
  // The deployed Cloudflare Worker cannot read them or call fetch at module
  // scope: both are request-scoped there. Only the validated public document,
  // not the configuration value itself, is embedded in the server bundle.
  const resolvedEnv = loadEnv(mode, ROOT_ENV_DIR, [
    "OTTERDEPLOY_OPENAPI_SPEC_URL",
    "OTTERSTACK_OPENAPI_SPEC_URL",
  ]);
  // oxlint-disable-next-line node/no-process-env
  const processCurrentSpecUrl = process.env.OTTERDEPLOY_OPENAPI_SPEC_URL;
  // oxlint-disable-next-line node/no-process-env -- compatibility with the pre-rename variable
  const processLegacySpecUrl = process.env.OTTERSTACK_OPENAPI_SPEC_URL;
  const specUrl = resolveOpenAPISpecEnvironment(
    {
      OTTERDEPLOY_OPENAPI_SPEC_URL: processCurrentSpecUrl,
      OTTERSTACK_OPENAPI_SPEC_URL: processLegacySpecUrl,
    },
    resolvedEnv,
  );

  const spec = await captureOpenAPISpec({
    environment,
    // Exported/CI variables take precedence over root .env files; within each
    // source, the current brand takes precedence over the legacy alias.
    specUrl,
    onUnavailable(error) {
      // Development stays useful when its local control plane is not running.
      // A configured production source is deliberately stricter: its error is
      // rethrown so a transient outage cannot deploy hundreds of route 404s.
      // oxlint-disable-next-line no-console -- this is a dev-server diagnostic
      console.error("[www] OpenAPI operation pages will not be generated", error);
    },
  });
  if (!spec) return null;

  try {
    // Structural checks catch unsafe inputs; this exercises Fumadocs' own
    // bundler/upgrader/page generator as well. A configured production build
    // must fail here, rather than discovering after deployment that every
    // operation route vanished. The Worker repeats this deterministic step
    // lazily only when its API-reference section is first requested.
    // Fumadocs performs the 3.0/3.1 → 3.2 upgrade here, but its input type is
    // narrower than the runtime loader. The source was structurally validated
    // above, so keep the assertion at this single library boundary.
    await createOpenAPI({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- checked source; Fumadocs upgrades 3.0/3.1 at this boundary
      input: { "otterdeploy.json": spec as OpenAPIV3_2.Document },
    }).staticSource(OPENAPI_PAGE_OPTIONS);
    return spec;
  } catch (error) {
    if (environment === "production") throw error;
    // oxlint-disable-next-line no-console -- this is a dev-server diagnostic
    console.error("[www] Fumadocs could not generate OpenAPI operation pages", error);
    return null;
  }
}

export default defineConfig(async ({ command, mode }) => ({
  define: {
    __DOCS_VERSION__: JSON.stringify(docsVersion()),
    __DOCS_GIT_HISTORY_COMPLETE__: JSON.stringify(hasCompleteGitHistory()),
    __OPENAPI_SPEC__: JSON.stringify(
      await docsOpenAPISpec(command === "build" ? "production" : "development", mode),
    ),
  },
  server: {
    allowedHosts: ["*"],
    // oxlint-disable-next-line node/no-process-env
    port: Number(process.env.PORT) || 3002,
  },
  plugins: [
    mdx(),
    tailwindcss(),
    tanstackStart({
      // SSR every route at request time. Build-time prerender is off: the docs
      // page enumeration for the `/docs/$` splat isn't wired. The OpenAPI
      // snapshot above is independent of route prerendering.
      prerender: { enabled: false },
    }),
    // The `build` script pins NODE_ENV=production, and must keep doing so.
    // With it unset, this plugin emits the automatic DEV JSX transform
    // (`jsxDEV` calls) into the SSR bundle while React resolves its PRODUCTION
    // exports: where `jsxDEV` is deliberately `void 0`. Result: every SSR
    // route 500s with "(0 , import_jsx_dev_runtime.jsxDEV) is not a function",
    // landing page included. `vite build` alone does not imply it here.
    react(),
    // Pinned to `cloudflare-module` rather than left to auto-detection: the
    // site deploys to Workers on every path (CI, `bun run deploy`, a local
    // `vite build`), so what you build locally is what ships. The preset emits
    // `.output/server/index.mjs` + `.output/public`, merges apps/www/
    // wrangler.jsonc into `.output/server/wrangler.json`, and enables the
    // `nodejs_compat` flag.
    // `noExternals` bundles every dependency into the server output instead of
    // tracing them into `.output/server/node_modules`, required on Workers,
    // which has no node_modules at runtime. It also fixes the Fumadocs/tslib
    // cluster, which traces incompletely (tslib's `modules/index.js` goes
    // missing) and 500s every SSR route.
    nitro({
      // `cloudflare-module`, not its std alias `cloudflare_workers`: nitro
      // 3.0.260603-beta fails to resolve the alias at any compatibilityDate.
      preset: "cloudflare-module",
      compatibilityDate: "2026-05-28",
      noExternals: true,
    }),
  ],
  resolve: {
    tsconfigPaths: true,
    // Force every tslib import (bare *and* deep subpaths) to its ESM build.
    // Two failures this prevents, both of which 500 every SSR route, landing
    // page included:
    //   1. Bare `tslib`: rolldown's CJS-interop wrapper makes the named helpers
    //      (`__extends`, `__assign`, …) come back undefined → "Cannot
    //      destructure property '__extends'".
    //   2. Deep `tslib/modules/index.js` (from @fumadocs/api-docs): left
    //      external, nitro traces only a subset of tslib's files so it resolves
    //      to a missing module at runtime.
    // `tslib.es6.mjs` re-exports all helpers as real named exports, so pointing
    // every specifier at it bundles them and skips the interop wrapper. The
    // regex captures the subpath but the replacement intentionally drops it.
    alias: [{ find: /^tslib(\/.*)?$/, replacement: "tslib/tslib.es6.mjs" }],
  },
  envDir: "../../",
}));
