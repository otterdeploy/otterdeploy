import { describe, expect, it } from "vite-plus/test";

import type { StackTemplate } from "./types";

import { filterTemplates, sortTemplates } from "./filter";

/**
 * Fixture prose lives here rather than in a locale bundle: the unit under test
 * is the MATCHING, and `describe` is a parameter on `filterTemplates` exactly
 * so a caller can supply its own resolver. In the app that resolver is
 * i18next's `t`.
 */
const DESCRIPTIONS: Record<string, string> = {
  ghost: "publishing",
  umami: "web analytics",
  minio: "object storage",
};

/** Stands in for `t`: `templates.catalog.<id>.description` → the prose. */
const describeTemplate = (key: StackTemplate["descriptionKey"]): string =>
  DESCRIPTIONS[key.split(".")[2] ?? ""] ?? "";

const t = (over: Partial<StackTemplate>): StackTemplate => ({
  id: "x",
  name: "X",
  descriptionKey: "templates.catalog.ghost.description",
  category: "cms",
  includes: [],
  requiredEnv: [],
  logoBrand: "X",
  docsUrl: "https://example.com",
  compose: "",
  ...over,
});

const FIXTURES: StackTemplate[] = [
  t({
    id: "ghost",
    name: "Ghost",
    category: "cms",
    descriptionKey: "templates.catalog.ghost.description",
    includes: ["ghost", "db"],
  }),
  t({
    id: "umami",
    name: "Umami",
    category: "analytics",
    descriptionKey: "templates.catalog.umami.description",
    includes: ["umami", "db"],
  }),
  t({
    id: "minio",
    name: "MinIO",
    category: "data",
    descriptionKey: "templates.catalog.minio.description",
    includes: ["minio"],
  }),
];

describe("filterTemplates", () => {
  it("passes everything through with no filter", () => {
    expect(
      filterTemplates(FIXTURES, { category: "all", query: "" }, describeTemplate),
    ).toHaveLength(3);
  });

  it("filters by category", () => {
    const out = filterTemplates(FIXTURES, { category: "analytics", query: "" }, describeTemplate);
    expect(out.map((x) => x.id)).toEqual(["umami"]);
  });

  it("matches query against name, description, and service names, case-insensitively", () => {
    expect(
      filterTemplates(FIXTURES, { category: "all", query: "GHOST" }, describeTemplate).map(
        (x) => x.id,
      ),
    ).toEqual(["ghost"]);
    expect(
      filterTemplates(FIXTURES, { category: "all", query: "storage" }, describeTemplate).map(
        (x) => x.id,
      ),
    ).toEqual(["minio"]);
    // "db" is a service name in two fixtures
    expect(
      filterTemplates(FIXTURES, { category: "all", query: "db" }, describeTemplate),
    ).toHaveLength(2);
  });

  it("combines category and query", () => {
    expect(
      filterTemplates(FIXTURES, { category: "cms", query: "storage" }, describeTemplate),
    ).toHaveLength(0);
  });

  // The regression the resolver parameter exists to prevent: matching the raw
  // key would make "storage" find nothing while "catalog" found everything.
  it("searches the resolved prose, never the key path", () => {
    expect(
      filterTemplates(FIXTURES, { category: "all", query: "catalog" }, describeTemplate),
    ).toHaveLength(0);
  });

  // Category-only callers can skip it; description just leaves the haystack.
  it("filters by category with no resolver", () => {
    const out = filterTemplates(FIXTURES, { category: "analytics", query: "" });
    expect(out.map((x) => x.id)).toEqual(["umami"]);
  });
});

describe("sortTemplates", () => {
  it("sorts A→Z", () => {
    expect(sortTemplates(FIXTURES, "az").map((x) => x.id)).toEqual(["ghost", "minio", "umami"]);
  });

  it("sorts by declared category order, then A→Z", () => {
    expect(sortTemplates(FIXTURES, "category").map((x) => x.id)).toEqual([
      "ghost", // cms
      "umami", // analytics
      "minio", // data
    ]);
  });

  it("does not mutate the input", () => {
    const input = [...FIXTURES];
    sortTemplates(input, "az");
    expect(input.map((x) => x.id)).toEqual(FIXTURES.map((x) => x.id));
  });
});
