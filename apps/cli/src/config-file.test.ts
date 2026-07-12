import type { Manifest } from "@otterdeploy/api/manifest";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { loadConfig, writeConfig } from "./config-file";

function tempConfig(name: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "otter-cli-"));
  return { path: join(dir, name), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const base: Manifest = {
  version: 1,
  project: "demo" as Manifest["project"],
  services: {
    web: {
      source: "image",
      image: "nginx:latest",
      replicas: 1,
      ports: [{ container: 80, appProtocol: "http", primary: true }],
    },
  },
  databases: { primary: { engine: "postgres", version: "16" } },
  composes: {},
};

describe("writeConfig round-trip", () => {
  it("preserves compose stacks (regression: composes were dropped)", async () => {
    const { path, cleanup } = tempConfig("otterdeploy.config.json");
    try {
      const withCompose: Manifest = {
        ...base,
        composes: {
          cache: { source: "inline", content: "services:\n  redis:\n    image: redis:7" },
        },
      };
      writeConfig(withCompose, path);
      const reloaded = await loadConfig(path);
      expect(reloaded.composes).toBeDefined();
      expect(reloaded.composes.cache).toMatchObject({ source: "inline" });
      expect(reloaded.services.web).toMatchObject({ source: "image", image: "nginx:latest" });
      expect(reloaded.databases.primary).toMatchObject({ engine: "postgres" });
    } finally {
      cleanup();
    }
  });

  it("omits an empty composes map so older files stay byte-identical", async () => {
    const { path, cleanup } = tempConfig("otterdeploy.config.json");
    try {
      writeConfig(base, path);
      const raw = await Bun.file(path).text();
      expect(raw).not.toContain("composes");
      const reloaded = await loadConfig(path);
      // schema default re-materializes it as an empty map on load
      expect(reloaded.composes).toEqual({});
    } finally {
      cleanup();
    }
  });

  it("rejects an invalid resource name before writing (no corrupt file)", async () => {
    const { path, cleanup } = tempConfig("otterdeploy.config.json");
    try {
      const bad = {
        ...base,
        // Upper-case + space violate the resourceName slug rule.
        services: { "Bad Name": base.services.web },
      } as unknown as Manifest;
      expect(() => writeConfig(bad, path)).toThrow();
      // Nothing was persisted — the write is gated behind validation.
      expect(await Bun.file(path).exists()).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("preserves environment overrides", async () => {
    const { path, cleanup } = tempConfig("otterdeploy.config.json");
    try {
      const withEnv: Manifest = {
        ...base,
        environments: { production: { services: { web: { replicas: 3 } } } },
      };
      writeConfig(withEnv, path);
      const reloaded = await loadConfig(path);
      expect(reloaded.environments?.production?.services?.web).toMatchObject({ replicas: 3 });
    } finally {
      cleanup();
    }
  });
});
