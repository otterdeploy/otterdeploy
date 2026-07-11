import { describe, expect, it } from "vite-plus/test";

import type { StackTemplate } from "./types";

import { filterTemplates, sortTemplates } from "./filter";

const t = (over: Partial<StackTemplate>): StackTemplate => ({
  id: "x",
  name: "X",
  description: "",
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
    description: "publishing",
    includes: ["ghost", "db"],
  }),
  t({
    id: "umami",
    name: "Umami",
    category: "analytics",
    description: "web analytics",
    includes: ["umami", "db"],
  }),
  t({
    id: "minio",
    name: "MinIO",
    category: "data",
    description: "object storage",
    includes: ["minio"],
  }),
];

describe("filterTemplates", () => {
  it("passes everything through with no filter", () => {
    expect(filterTemplates(FIXTURES, { category: "all", query: "" })).toHaveLength(3);
  });

  it("filters by category", () => {
    const out = filterTemplates(FIXTURES, { category: "analytics", query: "" });
    expect(out.map((x) => x.id)).toEqual(["umami"]);
  });

  it("matches query against name, description, and service names, case-insensitively", () => {
    expect(filterTemplates(FIXTURES, { category: "all", query: "GHOST" }).map((x) => x.id)).toEqual(
      ["ghost"],
    );
    expect(
      filterTemplates(FIXTURES, { category: "all", query: "storage" }).map((x) => x.id),
    ).toEqual(["minio"]);
    // "db" is a service name in two fixtures
    expect(filterTemplates(FIXTURES, { category: "all", query: "db" })).toHaveLength(2);
  });

  it("combines category and query", () => {
    expect(filterTemplates(FIXTURES, { category: "cms", query: "storage" })).toHaveLength(0);
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
