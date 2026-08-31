import { describe, expect, it } from "vite-plus/test";

import {
  applyFilters,
  basename,
  compileFilters,
  crumbsFor,
  parseSize,
  withToken,
} from "../browse-state";

const objects = [
  { key: "invoices/2026-08/INV-1.pdf", size: 2_400_000, storageClass: "STANDARD" },
  { key: "invoices/2026-08/manifest.jsonl", size: 9_100_000, storageClass: "STANDARD" },
  { key: "exports/orders.csv.gz", size: 412_000_000, storageClass: "GLACIER_IR" },
  { key: "logo.svg", size: 4_200, storageClass: "STANDARD" },
];

describe("the breadcrumb IS the prefix", () => {
  it("splits a prefix into navigable hops", () => {
    expect(crumbsFor("acme", "invoices/2026-08/")).toEqual([
      { label: "acme", prefix: "" },
      { label: "invoices", prefix: "invoices/" },
      { label: "2026-08", prefix: "invoices/2026-08/" },
    ]);
  });

  it("is just the bucket at the root", () => {
    expect(crumbsFor("acme", "")).toEqual([{ label: "acme", prefix: "" }]);
  });
});

describe("basename", () => {
  it("takes the last segment, for folder mode", () => {
    expect(basename("invoices/2026-08/INV-1.pdf")).toBe("INV-1.pdf");
    expect(basename("invoices/2026-08/")).toBe("2026-08");
    expect(basename("logo.svg")).toBe("logo.svg");
  });
});

describe("parseSize", () => {
  it("reads the units people actually type", () => {
    expect(parseSize("100")).toBe(100);
    expect(parseSize("1kb")).toBe(1_000);
    expect(parseSize("1.5 MB")).toBe(1_500_000);
    expect(parseSize("2GB")).toBe(2_000_000_000);
  });

  it("returns null rather than guessing", () => {
    expect(parseSize("big")).toBeNull();
    expect(parseSize("10 parsecs")).toBeNull();
  });
});

describe("filter tokens", () => {
  const run = (q: string) => applyFilters(objects, compileFilters(q)).map((o) => o.key);

  it("filters by prefix, which is the same thing as navigating", () => {
    expect(run("prefix:invoices/")).toEqual([
      "invoices/2026-08/INV-1.pdf",
      "invoices/2026-08/manifest.jsonl",
    ]);
  });

  it("filters by storage class and extension", () => {
    expect(run("class:GLACIER_IR")).toEqual(["exports/orders.csv.gz"]);
    expect(run("type:pdf")).toEqual(["invoices/2026-08/INV-1.pdf"]);
  });

  it("compares sizes", () => {
    expect(run("size:>100MB")).toEqual(["exports/orders.csv.gz"]);
    expect(run("size:<1MB")).toEqual(["logo.svg"]);
  });

  it("ANDs several tokens", () => {
    expect(run("prefix:invoices/ size:>5MB")).toEqual(["invoices/2026-08/manifest.jsonl"]);
  });

  it("treats an unrecognised token as a substring match, never as nothing", () => {
    // Silently dropping it would show the unfiltered list as if the filter had
    // worked, which is the worst of both outcomes.
    expect(run("orders")).toEqual(["exports/orders.csv.gz"]);
    expect(run("size:enormous")).toEqual([]);
  });

  it("returns everything for an empty query", () => {
    expect(run("")).toHaveLength(4);
    expect(run("   ")).toHaveLength(4);
  });
});

describe("withToken", () => {
  it("appends, and toggles a token that is already on", () => {
    expect(withToken("", "class:STANDARD")).toBe("class:STANDARD");
    expect(withToken("type:pdf", "class:STANDARD")).toBe("type:pdf class:STANDARD");
    expect(withToken("type:pdf class:STANDARD", "type:pdf")).toBe("class:STANDARD");
  });
});
