import { describe, expect, it } from "vite-plus/test";

import { filterRows, haystack, matchesTerms, searchTerms } from "./search";

describe("searchTerms", () => {
  it("lowercases and splits on any run of whitespace", () => {
    expect(searchTerms("  DE   Cloudflare ")).toEqual(["de", "cloudflare"]);
  });

  it("yields nothing for a blank query, which callers read as 'no filter'", () => {
    expect(searchTerms("   ")).toEqual([]);
  });
});

describe("haystack", () => {
  it("drops nullish and empty parts instead of stringifying them", () => {
    expect(haystack(["1.2.3.4", null, undefined, "", 42])).toBe("1.2.3.4 42");
  });
});

describe("matchesTerms", () => {
  it("requires every term (AND), not any", () => {
    const hay = haystack(["172.71.1.1", "DE", "AS13335 Cloudflare"]);
    expect(matchesTerms(hay, ["de", "cloudflare"])).toBe(true);
    expect(matchesTerms(hay, ["de", "ovh"])).toBe(false);
  });

  it("matches partial values, so a /16 prefix finds its whole range", () => {
    expect(matchesTerms(haystack(["172.71.164.174"]), ["172.71"])).toBe(true);
  });

  it("matches everything when there are no terms", () => {
    expect(matchesTerms("", [])).toBe(true);
  });
});

describe("filterRows", () => {
  const rows = [
    { ip: "1.1.1.1", country: "AU", scenario: "crowdsecurity/ssh-slow-bf" },
    { ip: "2.2.2.2", country: "DE", scenario: "manual:user_abc" },
  ];
  const fields = (r: (typeof rows)[number]) => [r.ip, r.country, r.scenario];

  it("keeps the array identity when nothing is being searched", () => {
    expect(filterRows(rows, "  ", fields)).toBe(rows);
  });

  it("narrows on any searchable field", () => {
    expect(filterRows(rows, "ssh", fields)).toEqual([rows[0]]);
    expect(filterRows(rows, "de", fields)).toEqual([rows[1]]);
  });
});
