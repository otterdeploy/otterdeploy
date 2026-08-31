import { describe, expect, it } from "vite-plus/test";

import {
  ancestorPrefixes,
  basename,
  crumbsFor,
  estimatedMonthlyUsd,
  formatSize,
  isImageKey,
  providerLabel,
} from "../state";

describe("crumbsFor", () => {
  it("the breadcrumb is the prefix, split", () => {
    expect(crumbsFor("acme", "invoices/2026-08/")).toEqual([
      { label: "acme", prefix: "" },
      { label: "invoices", prefix: "invoices/" },
      { label: "2026-08", prefix: "invoices/2026-08/" },
    ]);
  });
  it("root is just the bucket", () => {
    expect(crumbsFor("acme", "")).toEqual([{ label: "acme", prefix: "" }]);
  });
});

describe("ancestorPrefixes", () => {
  it("every hop, deepest last", () => {
    expect(ancestorPrefixes("a/b/c/")).toEqual(["a/", "a/b/", "a/b/c/"]);
    expect(ancestorPrefixes("")).toEqual([]);
  });
});

describe("basename", () => {
  it("last segment, trailing slash ignored", () => {
    expect(basename("invoices/2026-08/")).toBe("2026-08");
    expect(basename("logo.svg")).toBe("logo.svg");
  });
});

describe("formatSize", () => {
  it("decimal units, exact bytes", () => {
    expect(formatSize(128)).toBe("128 B");
    expect(formatSize(2_400_000)).toBe("2.4 MB");
    expect(formatSize(412_000_000_000)).toBe("412.0 GB");
  });
});

describe("providerLabel", () => {
  it("aws with and without a region", () => {
    expect(providerLabel({ endpoint: null, region: "eu-central-1" })).toBe("s3 · eu-central-1");
    expect(providerLabel({ endpoint: null, region: null })).toBe("s3");
  });
  it("known hosts get short names, others their hostname", () => {
    expect(
      providerLabel({ endpoint: "https://abc.r2.cloudflarestorage.com", region: "auto" }),
    ).toBe("r2");
    expect(providerLabel({ endpoint: "http://minio.internal:9000", region: null })).toBe(
      "minio.internal",
    );
  });
});

describe("estimatedMonthlyUsd", () => {
  it("sums list prices per class", () => {
    const usd = estimatedMonthlyUsd([
      { storageClass: "STANDARD", bytes: 1_000_000_000_000 }, // 1000 GB * 0.023
      { storageClass: "GLACIER_IR", bytes: 500_000_000_000 }, // 500 GB * 0.004
    ]);
    expect(usd).toBeCloseTo(25, 5);
  });
  it("an unknown class voids the estimate instead of shrinking it", () => {
    expect(estimatedMonthlyUsd([{ storageClass: "MYSTERY", bytes: 1 }])).toBeNull();
  });
});

describe("isImageKey", () => {
  it("by extension, case-insensitive", () => {
    expect(isImageKey("avatars/u-1.WEBP")).toBe(true);
    expect(isImageKey("invoices/INV-1.pdf")).toBe(false);
  });
});
