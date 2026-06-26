import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    allowedHosts: ["*"],
    // oxlint-disable-next-line node/no-process-env
    port: Number(process.env.PORT) || 3002,
  },
  plugins: [
    mdx(),
    tailwindcss(),
    // Prerender is intentionally OFF: the OpenAPI reference fetches the live
    // server spec (OTTERSTACK_OPENAPI_SPEC_URL) at render time, which isn't
    // reachable during a Vercel/CI build. Pages SSR on-demand at runtime.
    tanstackStart(),
    react(),
    nitro(),
  ],
  resolve: {
    tsconfigPaths: true,
    // Force tslib's ESM build. Several fumadocs deps ship TS-helper imports
    // (`__extends`, `__assign`, …); when the SSR bundle inlines tslib's CJS
    // through rolldown's interop wrapper the named exports come back undefined
    // and SSR throws "Cannot destructure property '__extends'". The ESM entry
    // exposes them as real named exports, so the interop wrapper is skipped.
    alias: [{ find: /^tslib$/, replacement: "tslib/tslib.es6.mjs" }],
  },
  envDir: "../../",
});
