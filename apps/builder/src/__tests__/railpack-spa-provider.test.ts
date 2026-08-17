/**
 * A declared SPA output directory the chosen provider can never produce is a
 * contradiction, and must fail before the image is built.
 *
 * The incident: the build log printed
 *   SPA mode: serving "dist" via Caddy with history fallback
 * and then, further down,
 *   ↳ Detected Staticfile
 * The Staticfile provider's whole build was `caddy fmt --overwrite Caddyfile`,
 * no bundler runs, so the image served a `dist/` nothing had created and every
 * request 404'd. Both facts were on screen, in order, and the build continued.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertProviderCanServeSpa } from "../railpack";

const tmpDirs: string[] = [];

/** Write a railpack `--info-out` analysis and return its path. */
function infoFile(detectedProviders: string[] | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), "otter-railpack-info-"));
  tmpDirs.push(dir);
  const path = join(dir, "railpack-info.json");
  writeFileSync(path, JSON.stringify({ detectedProviders, success: true }));
  return path;
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("assertProviderCanServeSpa", () => {
  test("throws when SPA output is declared but only Staticfile was detected", () => {
    // The regression, stated directly.
    expect(() =>
      assertProviderCanServeSpa({
        layout: { spaOutputDir: "dist", infoPath: infoFile(["staticfile"]) },
      }),
    ).toThrow(/serve the build output directory "dist"/);
  });

  test("the message names the provider and the likely cause", () => {
    let message = "";
    try {
      assertProviderCanServeSpa({
        layout: { spaOutputDir: "dist", infoPath: infoFile(["staticfile"]) },
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("staticfile");
    expect(message).toContain("runs no build step");
    expect(message).toContain("root directory");
  });

  test("is case-insensitive about the provider name", () => {
    expect(() =>
      assertProviderCanServeSpa({
        layout: { spaOutputDir: "dist", infoPath: infoFile(["Staticfile"]) },
      }),
    ).toThrow();
  });

  test("allows a provider that actually builds", () => {
    expect(() =>
      assertProviderCanServeSpa({
        layout: { spaOutputDir: "dist", infoPath: infoFile(["node"]) },
      }),
    ).not.toThrow();
  });

  test("allows Staticfile alongside a real builder", () => {
    // A node build that also matched staticfile can still produce `dist`.
    expect(() =>
      assertProviderCanServeSpa({
        layout: { spaOutputDir: "dist", infoPath: infoFile(["node", "staticfile"]) },
      }),
    ).not.toThrow();
  });

  test("no SPA output declared → nothing to contradict", () => {
    // A plain Staticfile site is a legitimate, common deployment.
    expect(() =>
      assertProviderCanServeSpa({
        layout: { spaOutputDir: null, infoPath: infoFile(["staticfile"]) },
      }),
    ).not.toThrow();
  });

  test("unreadable or missing analysis does not invent a failure", () => {
    expect(() =>
      assertProviderCanServeSpa({
        layout: { spaOutputDir: "dist", infoPath: join(tmpdir(), "definitely-not-here.json") },
      }),
    ).not.toThrow();
  });

  test("an empty provider list does not invent a failure", () => {
    expect(() =>
      assertProviderCanServeSpa({ layout: { spaOutputDir: "dist", infoPath: infoFile([]) } }),
    ).not.toThrow();
    expect(() =>
      assertProviderCanServeSpa({
        layout: { spaOutputDir: "dist", infoPath: infoFile(undefined) },
      }),
    ).not.toThrow();
  });
});
