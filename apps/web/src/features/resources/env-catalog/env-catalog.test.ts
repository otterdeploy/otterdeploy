import { describe, expect, it } from "vite-plus/test";

import { envSuggestionsForImage, matchEnvSuggestions, normalizeImageRepo } from "./index";

describe("normalizeImageRepo", () => {
  it("strips tags, digests, and implicit registry prefixes", () => {
    expect(normalizeImageRepo("postgres:17-alpine")).toBe("postgres");
    expect(normalizeImageRepo("docker.io/library/postgres@sha256:abc")).toBe("postgres");
    expect(normalizeImageRepo("ghcr.io/dr34mw0rk5/autumn:sha-7ed106c")).toBe(
      "ghcr.io/dr34mw0rk5/autumn",
    );
    // A registry port's colon sits before the last slash and must survive.
    expect(normalizeImageRepo("localhost:5000/team/app:v1")).toBe("localhost:5000/team/app");
  });
});

describe("envSuggestionsForImage", () => {
  it("resolves any pinned tag of a known repo", () => {
    const keys = envSuggestionsForImage("postgres:16-alpine").map((s) => s.key);
    expect(keys).toContain("POSTGRES_PASSWORD");
    expect(
      envSuggestionsForImage("docker.dragonflydb.io/dragonflydb/dragonfly:v1.27.2").length,
    ).toBeGreaterThan(0);
  });

  it("returns nothing for unknown images and empty input", () => {
    expect(envSuggestionsForImage("some/unknown-image:1")).toEqual([]);
    expect(envSuggestionsForImage(null)).toEqual([]);
  });
});

describe("matchEnvSuggestions", () => {
  const pg = envSuggestionsForImage("postgres:17-alpine");

  it("ranks prefix matches ahead of substring matches", () => {
    const got = matchEnvSuggestions(pg, "POSTGRES_P", new Set()).map((s) => s.key);
    expect(got[0]).toBe("POSTGRES_PASSWORD");
  });

  it("matches case-insensitively on substrings", () => {
    const got = matchEnvSuggestions(pg, "initdb", new Set()).map((s) => s.key);
    expect(got).toContain("POSTGRES_INITDB_ARGS");
  });

  it("drops keys already present in the editor and fully-typed keys", () => {
    const taken = new Set(["POSTGRES_PASSWORD"]);
    const got = matchEnvSuggestions(pg, "POSTGRES", taken).map((s) => s.key);
    expect(got).not.toContain("POSTGRES_PASSWORD");
    expect(matchEnvSuggestions(pg, "pgdata", new Set()).map((s) => s.key)).not.toContain("PGDATA");
  });

  it("surfaces the full unused list for an empty query", () => {
    expect(matchEnvSuggestions(pg, "", new Set()).length).toBe(pg.length);
  });
});
