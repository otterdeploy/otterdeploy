import { describe, expect, test } from "bun:test";

import {
  applyStorageFilters,
  compileStorageFilters,
  hasStorageToken,
  keyExtension,
  parseAge,
  parseSize,
  withStorageToken,
} from "../storage-filter";

const NOW = 1_756_600_000_000; // fixed anchor so `modified:` tests are stable

const DAY = 86_400_000;

function obj(key: string, over: Partial<{ size: number; storageClass: string; modifiedMs: number | null }> = {}) {
  return {
    key,
    size: over.size ?? 1_000,
    storageClass: over.storageClass ?? "STANDARD",
    modifiedMs: over.modifiedMs === undefined ? NOW - DAY : over.modifiedMs,
  };
}

function keysMatching(query: string, objects: ReturnType<typeof obj>[]): string[] {
  return applyStorageFilters(objects, compileStorageFilters(query, NOW)).map((o) => o.key);
}

describe("parseSize", () => {
  test("units scale decimally", () => {
    expect(parseSize("128")).toBe(128);
    expect(parseSize("1.5MB")).toBe(1_500_000);
    expect(parseSize("2 gb")).toBe(2_000_000_000);
  });
  test("rejects non-sizes", () => {
    expect(parseSize("big")).toBeNull();
    expect(parseSize("10q")).toBeNull();
  });
});

describe("parseAge", () => {
  test("hours through years", () => {
    expect(parseAge("12h")).toBe(12 * 3_600_000);
    expect(parseAge("30d")).toBe(30 * DAY);
    expect(parseAge("2w")).toBe(14 * DAY);
    expect(parseAge("1y")).toBe(365 * DAY);
  });
  test("rejects non-ages", () => {
    expect(parseAge("soon")).toBeNull();
  });
});

describe("keyExtension", () => {
  test("lowercases the last segment's extension", () => {
    expect(keyExtension("a/b/INV-1.PDF")).toBe("pdf");
    expect(keyExtension("orders.csv.gz")).toBe("gz");
  });
  test("dotfiles, extensionless and absurd extensions are null", () => {
    expect(keyExtension("a/.env")).toBeNull();
    expect(keyExtension("Makefile")).toBeNull();
    expect(keyExtension("a.thisistoolongtobereal")).toBeNull();
  });
});

describe("token filters", () => {
  const objects = [
    obj("invoices/2026-08/INV-1.pdf", { size: 2_400_000 }),
    obj("invoices/2026-08/manifest.jsonl", { size: 9_100_000 }),
    obj("exports/orders.csv.gz", { size: 412_000_000, storageClass: "GLACIER_IR", modifiedMs: NOW - 400 * DAY }),
    obj("logo.svg", { size: 4_200, modifiedMs: null }),
  ];

  test("class: matches case-insensitively", () => {
    expect(keysMatching("class:glacier_ir", objects)).toEqual(["exports/orders.csv.gz"]);
  });

  test("type: matches the real extension, not a substring", () => {
    expect(keysMatching("type:pdf", objects)).toEqual(["invoices/2026-08/INV-1.pdf"]);
    // `type:csv` must not match `.csv.gz` — its extension is gz.
    expect(keysMatching("type:csv", objects)).toEqual([]);
  });

  test("size: comparators", () => {
    expect(keysMatching("size:>100MB", objects)).toEqual(["exports/orders.csv.gz"]);
    expect(keysMatching("size:<5kb", objects)).toEqual(["logo.svg"]);
  });

  test("modified:>1y means untouched for over a year, and unknown matches neither side", () => {
    expect(keysMatching("modified:>1y", objects)).toEqual(["exports/orders.csv.gz"]);
    expect(keysMatching("modified:<30d", objects)).toEqual([
      "invoices/2026-08/INV-1.pdf",
      "invoices/2026-08/manifest.jsonl",
    ]);
  });

  test("prefix: and bare substrings", () => {
    expect(keysMatching("prefix:invoices/", objects)).toHaveLength(2);
    expect(keysMatching("orders", objects)).toEqual(["exports/orders.csv.gz"]);
  });

  test("tokens AND together", () => {
    expect(keysMatching("prefix:invoices/ size:>5MB", objects)).toEqual([
      "invoices/2026-08/manifest.jsonl",
    ]);
  });
});

describe("withStorageToken", () => {
  test("toggles", () => {
    expect(withStorageToken("", "class:STANDARD")).toBe("class:STANDARD");
    expect(withStorageToken("class:STANDARD type:pdf", "class:STANDARD")).toBe("type:pdf");
  });
  test("hasStorageToken reports chip state", () => {
    expect(hasStorageToken("class:STANDARD type:pdf", "type:pdf")).toBe(true);
    expect(hasStorageToken("class:STANDARD", "type:pdf")).toBe(false);
  });
});
