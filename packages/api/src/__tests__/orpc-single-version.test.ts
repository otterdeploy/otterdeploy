/**
 * Exactly one @orpc/* version in the workspace, and a typed error a
 * handler throws keeps its status over the OpenAPI door.
 *
 * oRPC recognises an ORPCError through a registry keyed by the @orpc/client
 * version (`Symbol.for("__@orpc/client@<version>/...")`), so when two versions
 * are installed side by side, an error built with one copy's `new ORPCError`
 * is not an ORPCError to a handler from the other copy. That is what happened:
 * @orpc/openapi@1.14.1 pinned @orpc/server+client@1.14.1 while packages/api
 * built procedures with 1.14.3, and every handler-built ORPCError (e.g.
 * project.proxyRoute.inviteGuest's UNAUTHORIZED) came out of /api/reference as
 * a 500 while /rpc said 401. Contract errors (`errors.X()`) were unaffected.
 *
 * The fix is one catalog version for every @orpc/* package (root
 * package.json `workspaces.catalog`). The guards below fail the moment a
 * second copy reappears in bun.lock or a workspace pins @orpc/* outside the
 * catalog.
 */
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { ORPCError, os } from "@orpc/server";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import * as z from "zod";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname;

const rootManifestSchema = z.object({
  workspaces: z.object({
    packages: z.array(z.string()),
    catalog: z.record(z.string(), z.string()),
  }),
  overrides: z.record(z.string(), z.string()).optional(),
});

const workspaceManifestSchema = z.object({
  name: z.string(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
});

const rootManifest = rootManifestSchema.parse(
  JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")),
);

/** Every workspace directory the root `workspaces.packages` globs name. */
function workspaceDirectories(patterns: readonly string[]): string[] {
  return patterns.flatMap((pattern) => {
    if (!pattern.includes("*")) return [pattern];
    if (!pattern.endsWith("/*") || pattern.indexOf("*") !== pattern.length - 1)
      throw new Error(`unsupported workspace glob ${pattern}: only "<dir>/*" is expanded here`);
    const parent = pattern.slice(0, -2);
    return readdirSync(join(REPO_ROOT, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });
}

/** `@orpc/<name>` -> every version bun.lock resolved it to. */
function lockedOrpcVersions(lockText: string): Map<string, Set<string>> {
  // A resolved package is the first element of its entry's array:
  //   "@orpc/openapi/@orpc/server": ["@orpc/server@1.14.1", "", { ... }, "sha512-..."]
  const versions = new Map<string, Set<string>>();
  for (const match of lockText.matchAll(/\["(@orpc\/[a-z0-9-]+)@([^"]+)"/g)) {
    const [, name = "", version = ""] = match;
    const seen = versions.get(name) ?? new Set<string>();
    seen.add(version);
    versions.set(name, seen);
  }
  return versions;
}

describe("one @orpc/* version across the workspace", () => {
  it("bun.lock resolves every @orpc/* package to one and the same version", () => {
    const locked = lockedOrpcVersions(readFileSync(join(REPO_ROOT, "bun.lock"), "utf8"));
    expect(locked.has("@orpc/server")).toBe(true);
    const duplicated = [...locked]
      .filter(([, versions]) => versions.size > 1)
      .map(([name, versions]) => `${name}: ${[...versions].join(", ")}`);
    expect(duplicated).toEqual([]);
    const allVersions = new Set([...locked.values()].flatMap((versions) => [...versions]));
    expect([...allVersions]).toHaveLength(1);
  });

  it("the catalog pins every @orpc/* entry to that exact version", () => {
    const pins = Object.entries(rootManifest.workspaces.catalog).filter(([name]) =>
      name.startsWith("@orpc/"),
    );
    expect(pins.length).toBeGreaterThan(0);
    const distinct = new Set(pins.map(([, range]) => range));
    expect([...distinct]).toHaveLength(1);
    // An exact version, not a range: a caret lets one package float ahead of
    // the others on the next `bun update`.
    expect([...distinct][0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("every workspace takes @orpc/* from the catalog, never its own range", () => {
    const offCatalog: string[] = [];
    for (const directory of workspaceDirectories(rootManifest.workspaces.packages)) {
      const path = join(REPO_ROOT, directory, "package.json");
      if (!existsSync(path)) continue;
      const manifest = workspaceManifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
      const declared = {
        ...manifest.peerDependencies,
        ...manifest.devDependencies,
        ...manifest.dependencies,
      };
      for (const [name, range] of Object.entries(declared))
        if (name.startsWith("@orpc/") && range !== "catalog:")
          offCatalog.push(`${manifest.name}: ${name}@${range}`);
    }
    expect(offCatalog).toEqual([]);
  });
});

describe("a handler-built ORPCError keeps its status over the OpenAPI handler", () => {
  const router = {
    guarded: os.route({ method: "POST", path: "/guarded" }).handler(() => {
      throw new ORPCError("UNAUTHORIZED", { message: "an API key cannot do this" });
    }),
    custom: os.route({ method: "POST", path: "/custom" }).handler(() => {
      throw new ORPCError("RESOURCE_BUSY", { status: 409, message: "still deploying" });
    }),
  };
  const handler = new OpenAPIHandler(router);

  async function callOpenApi(path: string): Promise<{ status: number; body: unknown }> {
    const result = await handler.handle(
      new Request(`http://control-plane.test/api/reference${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { prefix: "/api/reference", context: {} },
    );
    if (!result.matched) throw new Error(`/api/reference${path} matched no route`);
    return { status: result.response.status, body: await result.response.json() };
  }

  it("a standard code (UNAUTHORIZED) answers 401 with its code and message, not 500", async () => {
    expect(await callOpenApi("/guarded")).toEqual({
      status: 401,
      body: expect.objectContaining({
        code: "UNAUTHORIZED",
        message: "an API key cannot do this",
      }),
    });
  });

  it("a custom code with an explicit status keeps both", async () => {
    expect(await callOpenApi("/custom")).toEqual({
      status: 409,
      body: expect.objectContaining({ code: "RESOURCE_BUSY", message: "still deploying" }),
    });
  });
});
