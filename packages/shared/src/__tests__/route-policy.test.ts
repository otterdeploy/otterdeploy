import { describe, expect, test } from "bun:test";

/**
 * `routePolicy` is a jsonb column, so every row written before a field existed
 * is missing that field. The builder reads the column through
 * `routePolicySchema.safeParse` and falls back to DEFAULT_ROUTE_POLICY on
 * failure — which means a field added WITHOUT a default would not merely
 * default itself, it would silently reset every other policy value on every
 * pre-existing route. That is the property pinned here.
 */
import type { RoutePolicy } from "../route-policy";

import { DEFAULT_ROUTE_POLICY, routePolicySchema } from "../route-policy";

/** What a row predating `upstreamProtocol` should parse to. Typed, so the
 *  comparison below is against a real RoutePolicy rather than a widened
 *  object literal. */
const expected: RoutePolicy = {
  compression: "gzip",
  maxRequestBodyMb: 25,
  hsts: "one-year",
  contentTypeNosniff: true,
  frameOptions: "deny",
  referrerPolicy: "same-origin",
  contentSecurityPolicy: null,
  upstreamProtocol: "http",
};

/** The row as actually stored: `expected` minus the field that did not exist
 *  yet. Loosely typed, because that is how jsonb arrives at runtime. */
const legacyRow: Record<string, unknown> = {
  compression: "gzip",
  maxRequestBodyMb: 25,
  hsts: "one-year",
  contentTypeNosniff: true,
  frameOptions: "deny",
  referrerPolicy: "same-origin",
  contentSecurityPolicy: null,
};

describe("routePolicySchema", () => {
  test("a row predating upstreamProtocol parses, keeping its other values", () => {
    // `parse`, not `safeParse`: it returns the policy itself rather than a
    // union, and a failure here should fail the test loudly.
    expect(routePolicySchema.parse(legacyRow)).toEqual(expected);
  });

  test("the default policy dials plain HTTP", () => {
    expect(DEFAULT_ROUTE_POLICY.upstreamProtocol).toBe("http");
  });

  test("h2c is accepted and anything else is not", () => {
    expect(routePolicySchema.safeParse({ ...legacyRow, upstreamProtocol: "h2c" }).success).toBe(
      true,
    );
    expect(routePolicySchema.safeParse({ ...legacyRow, upstreamProtocol: "h3" }).success).toBe(
      false,
    );
  });

  // `.strict()` is what stops a hand-edited row smuggling an unknown key
  // through to the renderer.
  test("an unknown key is rejected outright", () => {
    expect(routePolicySchema.safeParse({ ...legacyRow, somethingElse: true }).success).toBe(false);
  });
});
