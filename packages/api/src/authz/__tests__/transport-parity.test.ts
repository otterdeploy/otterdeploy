import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");

const transportSources = {
  orpc: "packages/api/src/index.ts",
  rawUpload: "apps/server/src/handlers/upload/source.ts",
  websocketPty: "apps/server/src/handlers/terminal/auth.ts",
} as const;

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

describe("authorization transport parity", () => {
  for (const [transport, path] of Object.entries(transportSources)) {
    test(`${transport} delegates decisions to the central capability service`, () => {
      expect(source(path)).toContain("authorizeCapability(");
    });
  }

  for (const path of [transportSources.rawUpload, transportSources.websocketPty]) {
    test(`${path} delegates actor resolution instead of hand-verifying credentials`, () => {
      const text = source(path);
      expect(text).toContain("resolveRequestActor(");
      expect(text).not.toContain("auth.api.getSession");
      expect(text).not.toContain("auth.api.verifyApiKey");
    });
  }
});
