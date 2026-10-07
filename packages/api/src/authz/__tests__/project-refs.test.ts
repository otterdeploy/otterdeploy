/**
 * API-key project scope is enforced from a declaration, and the
 * declaration is complete. The router walk below is the drift detector: a new
 * procedure whose input names an object (`id`, `*Id`, `*Ids`, at any depth)
 * fails here until it says what that object is, so it cannot silently skip
 * the project-scope check the way project.update (`id`) and the org-scoped
 * project reads once did.
 */
import { isProcedure } from "@orpc/server";
import { describe, expect, test } from "vite-plus/test";

import { appRouter } from "../../routers";
import { inputProjectRefs, parseProjectRefs, projectRefs } from "../project-refs";
import { inputPaths, unclassifiedPaths } from "./input-paths";

describe("inputProjectRefs", () => {
  test("conventional fields name their kind; organization-level ones name nothing", () => {
    const { refs, undeclared } = inputProjectRefs(
      { projectId: "prj_a", resourceIds: ["res_a", "res_b"], serverId: "srv_a", name: "x" },
      {},
    );
    expect(undeclared).toEqual([]);
    expect([...refs].map(([kind, ids]) => [kind, [...ids]])).toEqual([
      ["project", ["prj_a"]],
      ["resource", ["res_a", "res_b"]],
    ]);
  });

  test("a declaration names `id`, and overrides a convention for its procedure", () => {
    const { refs } = inputProjectRefs(
      { id: "prj_a", projectId: "ext-123" },
      {
        id: "project",
        projectId: "none",
      },
    );
    expect([...refs].map(([kind, ids]) => [kind, [...ids]])).toEqual([["project", ["prj_a"]]]);
  });

  test("nested declarations follow dotted paths, `*` over arrays and records", () => {
    const { refs } = inputProjectRefs(
      { target: { kind: "resource", resourceId: "res_a" }, items: [{ routeId: "rt_a" }] },
      { "target.resourceId": "resource", "items.*.routeId": "proxyRoute" },
    );
    expect([...refs].map(([kind, ids]) => [kind, [...ids]])).toEqual([
      ["resource", ["res_a"]],
      ["proxyRoute", ["rt_a"]],
    ]);
  });

  test("an undeclared id-like field is reported (the middleware fails closed on it)", () => {
    expect(inputProjectRefs({ id: "x", widgetId: "w", toString: "t" }, {}).undeclared).toEqual([
      "id",
      "widgetId",
    ]);
  });

  test("parseProjectRefs reads the contract meta and rejects an unknown kind", () => {
    expect(parseProjectRefs({ path: "/x", ...projectRefs({ id: "resource" }) })).toEqual({
      id: "resource",
    });
    expect(parseProjectRefs(undefined)).toEqual({});
    expect(parseProjectRefs({ projectRefs: { id: "projet" } })).toBeNull();
  });
});

interface Row {
  name: string;
  meta: unknown;
  inputSchema: unknown;
}

const rows: Row[] = [];
(function walk(node: unknown, path: readonly string[]) {
  if (isProcedure(node)) {
    const definition = node["~orpc"];
    rows.push({ name: path.join("."), meta: definition.meta, inputSchema: definition.inputSchema });
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, child] of Object.entries(node)) walk(child, [...path, key]);
})(appRouter, []);

describe("every procedure declares what its input names", () => {
  test("the router walk found the procedures", () => {
    expect(rows.length).toBeGreaterThan(400);
  });

  test("every meta.projectRefs parses", () => {
    expect(rows.filter((row) => parseProjectRefs(row.meta) === null).map((r) => r.name)).toEqual(
      [],
    );
  });

  test("every id-like input field, at any depth, is classified", () => {
    const missing = rows.flatMap((row) =>
      unclassifiedPaths(inputPaths(row.inputSchema), parseProjectRefs(row.meta) ?? {}).map(
        (path) => `${row.name}: ${path}`,
      ),
    );
    expect(missing).toEqual([]);
  });

  test("every declared path exists in the procedure's input (no stale declarations)", () => {
    const stale = rows.flatMap((row) => {
      const paths = inputPaths(row.inputSchema);
      return Object.keys(parseProjectRefs(row.meta) ?? {})
        .filter((path) => !paths.has(path))
        .map((path) => `${row.name}: ${path}`);
    });
    expect(stale).toEqual([]);
  });
});
