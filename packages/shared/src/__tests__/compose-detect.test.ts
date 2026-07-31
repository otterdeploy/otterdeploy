/**
 * Compose-file detection, shared by the wizard, the api handler and the
 * builder's clone probe.
 *
 * The incident behind these: a repo with a perfectly ordinary
 * `docker-compose.yml` reached the import wizard and detected nothing, because
 * the wizard never looked — its "auto-detect" was a placeholder string, and the
 * real candidate list lived in two other packages. Precedence is pinned here so
 * the three call sites cannot disagree about which file wins.
 */

import { describe, expect, it } from "vite-plus/test";

import { COMPOSE_FILENAMES, detectComposeFilename, detectComposeFilenames } from "../compose";

describe("detectComposeFilename", () => {
  it("finds each conventional name on its own", () => {
    for (const name of COMPOSE_FILENAMES) {
      expect(detectComposeFilename([name])).toBe(name);
    }
  });

  it("finds the file the waves repo actually ships", () => {
    // The exact listing that detected nothing before this change.
    const entries = ["Dockerfile", "README.md", "docker-compose.yml", "railway.json", "server"];
    expect(detectComposeFilename(entries)).toBe("docker-compose.yml");
  });

  it("prefers compose.yml over docker-compose.yml, per docker's own order", () => {
    expect(detectComposeFilename(["docker-compose.yml", "compose.yml"])).toBe("compose.yml");
    expect(detectComposeFilename(["docker-compose.yaml", "compose.yaml"])).toBe("compose.yaml");
  });

  it("does not resolve on listing order", () => {
    // Same set, both orders — the answer must not depend on readdir/tree order.
    const a = detectComposeFilename(["compose.yaml", "docker-compose.yml"]);
    const b = detectComposeFilename(["docker-compose.yml", "compose.yaml"]);
    expect(a).toBe(b);
    expect(a).toBe("compose.yaml");
  });

  it("returns null when nothing qualifies", () => {
    expect(detectComposeFilename([])).toBeNull();
    expect(detectComposeFilename(["Dockerfile", "package.json", "index.html"])).toBeNull();
  });

  it("does not match near-misses", () => {
    // A compose file for another tool, or a template, is not the stack's file.
    expect(detectComposeFilename(["docker-compose.prod.yml", "compose.override.yml"])).toBeNull();
    expect(detectComposeFilename(["Docker-Compose.yml"])).toBeNull();
  });
});

describe("detectComposeFilenames", () => {
  it("returns every candidate in precedence order", () => {
    const found = detectComposeFilenames(["docker-compose.yaml", "compose.yml", "Dockerfile"]);
    expect(found).toEqual(["compose.yml", "docker-compose.yaml"]);
  });

  it("agrees with the single-pick helper on its first element", () => {
    const listing = ["docker-compose.yml", "compose.yaml"];
    expect(detectComposeFilenames(listing)[0]).toBe(detectComposeFilename(listing));
  });

  it("is empty, not null, when nothing matches", () => {
    expect(detectComposeFilenames(["Dockerfile"])).toEqual([]);
  });
});
