import { afterEach, describe, expect, test } from "vite-plus/test";

import { lookupCountry } from "../geo";

/** lookupCountry reads the opened reader off globalThis (shared across --hot
 *  reloads). We swap in a fake to exercise both record layouts + the disabled
 *  and error paths without a real .mmdb. */
const g = globalThis as typeof globalThis & { __edgeGeoReader?: unknown };

afterEach(() => {
  g.__edgeGeoReader = undefined;
});

describe("lookupCountry", () => {
  test("reads the flat country_code layout (ip-location-db / DB-IP)", () => {
    g.__edgeGeoReader = { get: () => ({ country_code: "IN" }) };
    expect(lookupCountry("159.89.174.87")).toBe("IN");
  });

  test("reads the nested country.iso_code layout (MaxMind GeoLite2)", () => {
    g.__edgeGeoReader = { get: () => ({ country: { iso_code: "US" } }) };
    expect(lookupCountry("8.8.8.8")).toBe("US");
  });

  test("returns null when geo is disabled (no reader)", () => {
    g.__edgeGeoReader = undefined;
    expect(lookupCountry("8.8.8.8")).toBeNull();
  });

  test("returns null for an empty ip without touching the reader", () => {
    g.__edgeGeoReader = {
      get: () => {
        throw new Error("should not be called");
      },
    };
    expect(lookupCountry("")).toBeNull();
  });

  test("returns null when the record has no country and swallows reader throws", () => {
    g.__edgeGeoReader = { get: () => null };
    expect(lookupCountry("10.0.0.1")).toBeNull();
    g.__edgeGeoReader = {
      get: () => {
        throw new Error("corrupt db");
      },
    };
    expect(lookupCountry("10.0.0.1")).toBeNull();
  });
});
