import type { Manifest, ServiceManifest } from "@otterdeploy/api/manifest";

import { ID_PREFIX, zSlug } from "@otterdeploy/shared/id";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  configExists,
  configPath,
  JSON_CONFIG_FILENAME,
  loadConfig,
  TS_CONFIG_FILENAME,
  writeConfig,
} from "./config-file";

function tempConfig(name: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "otter-cli-"));
  return { path: join(dir, name), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const webService: ServiceManifest = {
  source: "image",
  image: "nginx:latest",
  replicas: 1,
  ports: [{ container: 80, appProtocol: "http", primary: true }],
};

const base: Manifest = {
  version: 1,
  // Brand the slug the same way the manifest schema does at the boundary.
  project: zSlug(ID_PREFIX.project).parse("demo"),
  services: { web: webService },
  databases: { primary: { engine: "postgres", version: "16" } },
  composes: {},
};

describe("writeConfig round-trip", () => {
  it("preserves compose stacks (regression: composes were dropped)", async () => {
    const { path, cleanup } = tempConfig("otterdeploy.json");
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
    const { path, cleanup } = tempConfig("otterdeploy.json");
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
    const { path, cleanup } = tempConfig("otterdeploy.json");
    try {
      // Type-level the key is any string; the runtime resourceName slug rule
      // is what rejects the upper-case + space name.
      const bad: Manifest = {
        ...base,
        services: { "Bad Name": webService },
      };
      expect(() => writeConfig(bad, path)).toThrow();
      // Nothing was persisted. The write is gated behind validation.
      expect(await Bun.file(path).exists()).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("preserves environment overrides", async () => {
    const { path, cleanup } = tempConfig("otterdeploy.json");
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

// `.config.` was dropped from the filename in 0.8. Resolution order is the only
// thing keeping a repo written by an earlier CLI working, and nothing else in
// the suite would notice if an entry were dropped from the basename list or
// reordered: the failure mode is "No config at …" on a repo that has one.
describe("config filename resolution", () => {
  function tempDir(): { dir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), "otter-cli-names-"));
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  it("scaffolds the short names", () => {
    expect(JSON_CONFIG_FILENAME).toBe("otterdeploy.json");
    expect(TS_CONFIG_FILENAME).toBe("otterdeploy.ts");
  });

  it("still resolves a legacy otterdeploy.config.json", () => {
    const { dir, cleanup } = tempDir();
    try {
      writeFileSync(join(dir, "otterdeploy.config.json"), "{}");
      expect(configExists(undefined, dir)).toBe(true);
      expect(configPath(undefined, dir)).toBe(join(dir, "otterdeploy.config.json"));
    } finally {
      cleanup();
    }
  });

  it("prefers the current name when both spellings are present", () => {
    const { dir, cleanup } = tempDir();
    try {
      writeFileSync(join(dir, "otterdeploy.config.json"), "{}");
      writeFileSync(join(dir, "otterdeploy.json"), "{}");
      expect(configPath(undefined, dir)).toBe(join(dir, "otterdeploy.json"));
    } finally {
      cleanup();
    }
  });

  it("falls back to the json default in an empty directory", () => {
    const { dir, cleanup } = tempDir();
    try {
      expect(configExists(undefined, dir)).toBe(false);
      expect(configPath(undefined, dir)).toBe(join(dir, "otterdeploy.json"));
    } finally {
      cleanup();
    }
  });
});
