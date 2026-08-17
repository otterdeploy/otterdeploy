import { describe, expect, test } from "bun:test";

import type { IdPrefix } from "../id";

import {
  canonicalId,
  createId,
  hasPrefix,
  ID_PREFIX,
  idPrefix,
  LEGACY_ID_PREFIX,
  zId,
} from "../id";

/** Object.entries erases the key type; this genuinely checks membership. */
function isPrefixKey(key: string): key is keyof typeof ID_PREFIX {
  return key in ID_PREFIX;
}

describe("ID_PREFIX", () => {
  test("every prefix is unique", () => {
    const values = Object.values(ID_PREFIX);
    expect(new Set(values).size).toBe(values.length);
  });

  test("no prefix contains an underscore", () => {
    // `idPrefix` splits on the FIRST underscore, so a prefix containing one can
    // never be read back out. `proxy_route` did, and `idPrefix` returned
    // "proxy" for every route id.
    for (const [key, value] of Object.entries(ID_PREFIX)) {
      expect(value, key).not.toContain("_");
    }
  });

  test("prefixes are short", () => {
    for (const [key, value] of Object.entries(ID_PREFIX)) {
      expect(value.length, key).toBeLessThanOrEqual(5);
    }
  });

  test("createId mints only the SHORT form", () => {
    expect(createId(ID_PREFIX.project).startsWith("prj_")).toBe(true);
    expect(createId(ID_PREFIX.deployment).startsWith("dep_")).toBe(true);
  });

  test("idPrefix reads the prefix back out", () => {
    expect(idPrefix(createId(ID_PREFIX.proxyRoute))).toBe("rt");
  });
});

describe("legacy compatibility", () => {
  // Every ID already in the database, in a manifest, in a swarm label or in a
  // bookmarked URL still carries the long prefix. zId validates prefixes at
  // runtime, so rejecting the old spelling would fail every existing row at the
  // API boundary.
  test("zId accepts both the new and the legacy spelling", () => {
    const schema = zId(ID_PREFIX.project);
    expect(schema.safeParse("prj_abc123").success).toBe(true);
    expect(schema.safeParse("project_mze9u0mgjah2gvroyzjoqqvm").success).toBe(true);
  });

  test("zId still rejects a different entity's id", () => {
    const schema = zId(ID_PREFIX.project);
    expect(schema.safeParse("dep_abc123").success).toBe(false);
    expect(schema.safeParse("deployment_abc123").success).toBe(false);
    expect(schema.safeParse("abc123").success).toBe(false);
  });

  test("hasPrefix recognises an id minted before the rename", () => {
    expect(hasPrefix("resource_navktpvsrmu7acmfkzn82txw", ID_PREFIX.resource)).toBe(true);
    expect(hasPrefix("res_navktpvsrmu7acmfkzn82txw", ID_PREFIX.resource)).toBe(true);
    expect(hasPrefix("dep_x", ID_PREFIX.resource)).toBe(false);
  });

  test("an entity with no legacy entry only accepts its one spelling", () => {
    // `env` never changed, so there is nothing extra to accept.
    expect(LEGACY_ID_PREFIX).not.toHaveProperty("environment");
    expect(zId(ID_PREFIX.environment).safeParse("env_abc").success).toBe(true);
  });

  test("legacy entries name a real prefix key and differ from the current one", () => {
    for (const [key, old] of Object.entries(LEGACY_ID_PREFIX)) {
      expect(ID_PREFIX).toHaveProperty(key);
      if (!isPrefixKey(key)) continue; // toHaveProperty above already failed
      expect(old).not.toBe(ID_PREFIX[key]);
    }
  });
});

describe("canonicalId", () => {
  test("rewrites every legacy prefix to its current spelling", () => {
    for (const [key, old] of Object.entries(LEGACY_ID_PREFIX)) {
      if (!isPrefixKey(key)) throw new Error(`legacy key ${key} is not an ID_PREFIX key`);
      const current = ID_PREFIX[key];
      expect(canonicalId(`${old}_abcdefghijkmnpqrstuvwxyz`)).toBe(
        `${current}_abcdefghijkmnpqrstuvwxyz`,
      );
    }
  });

  test("rewrites a legacy prefix that itself contains an underscore", () => {
    // `proxy_route` is why this matches longest-first rather than splitting on
    // the first `_` -- that split reads the prefix as `proxy` and misses it.
    expect(canonicalId("proxy_route_e9xvvkh15gu8t98h78w2spmj")).toBe(
      `${ID_PREFIX.proxyRoute}_e9xvvkh15gu8t98h78w2spmj`,
    );
  });

  test("leaves current ids, unknown prefixes and unprefixed strings alone", () => {
    for (const current of Object.values(ID_PREFIX)) {
      const id = `${current}_abcdefghijkmnpqrstuvwxyz`;
      expect(canonicalId(id)).toBe(id);
    }
    expect(canonicalId("unknown_abc")).toBe("unknown_abc");
    expect(canonicalId("nounderscore")).toBe("nounderscore");
    expect(canonicalId("")).toBe("");
  });

  test("is idempotent", () => {
    const once = canonicalId("resource_f4eokewwh6rn9f0i8d21wzrl");
    expect(canonicalId(once)).toBe(once);
  });
});

describe("zId legacy handling", () => {
  // `parse` returns a branded `Id<P>`; compare as plain strings.
  const parse = (prefix: IdPrefix, id: string): string => zId(prefix).parse(id);

  test("rewrites a legacy id to the current spelling", () => {
    // Accepting the old spelling is only useful if it also translates -- an
    // untranslated id passes validation and then matches no row.
    expect(parse(ID_PREFIX.project, "project_mze9u0mgjah2gvroyzjoqqvm")).toBe(
      "prj_mze9u0mgjah2gvroyzjoqqvm",
    );
    expect(parse(ID_PREFIX.proxyRoute, "proxy_route_e9xvvkh15gu8t98h78w2spmj")).toBe(
      "rt_e9xvvkh15gu8t98h78w2spmj",
    );
  });

  test("passes current ids through untouched", () => {
    expect(parse(ID_PREFIX.project, "prj_mze9u0mgjah2gvroyzjoqqvm")).toBe(
      "prj_mze9u0mgjah2gvroyzjoqqvm",
    );
  });

  test("still rejects a different entity's prefix", () => {
    expect(() => parse(ID_PREFIX.project, "res_mze9u0mgjah2gvroyzjoqqvm")).toThrow();
    expect(() => parse(ID_PREFIX.project, "resource_mze9u0mgjah2gvroyzjoqqvm")).toThrow();
  });
});
