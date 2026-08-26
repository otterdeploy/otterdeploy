import { describe, expect, test } from "vite-plus/test";

import {
  MAX_PATH_LENGTH,
  compileExcludePaths,
  languageOf,
  matchesExcludePath,
  parsePageUrl,
  referrerHostOf,
  screenWidthOf,
  uaFamiliesOf,
} from "../enrich";

describe("parsePageUrl", () => {
  test("keeps host + path, drops query and fragment except UTM", () => {
    const page = parsePageUrl(
      "https://Example.com:8443/Pricing?q=secret&utm_source=news&utm_medium=email&utm_campaign=aug&utm_term=t&utm_content=c#frag",
    );
    expect(page).toEqual({
      host: "example.com",
      path: "/Pricing",
      utm: { source: "news", medium: "email", campaign: "aug", term: "t", content: "c" },
    });
  });

  test("empty path becomes / and long paths are capped", () => {
    expect(parsePageUrl("https://example.com")?.path).toBe("/");
    const long = parsePageUrl(`https://example.com/${"a".repeat(2_000)}`);
    expect(long?.path.length).toBe(MAX_PATH_LENGTH);
  });

  test("missing utm params come back null, empty ones dropped", () => {
    const page = parsePageUrl("https://example.com/?utm_source=&utm_medium=ads");
    expect(page?.utm).toEqual({
      source: null,
      medium: "ads",
      campaign: null,
      term: null,
      content: null,
    });
  });

  test("rejects non-http and malformed URLs", () => {
    expect(parsePageUrl("javascript:alert(1)")).toBeNull();
    expect(parsePageUrl("file:///etc/passwd")).toBeNull();
    expect(parsePageUrl("not a url")).toBeNull();
  });
});

describe("referrerHostOf", () => {
  test("self-referral is null (Direct)", () => {
    expect(referrerHostOf("https://example.com/blog", "example.com")).toBeNull();
    expect(referrerHostOf("https://www.example.com/", "example.com")).toBeNull();
  });

  test("cross-host referrers keep their host, www-stripped", () => {
    expect(referrerHostOf("https://www.google.com/search?q=x", "example.com")).toBe("google.com");
    expect(referrerHostOf("https://news.ycombinator.com/item?id=1", "example.com")).toBe(
      "news.ycombinator.com",
    );
  });

  test("absent or malformed referrers are null", () => {
    expect(referrerHostOf(undefined, "example.com")).toBeNull();
    expect(referrerHostOf("", "example.com")).toBeNull();
  });
});

describe("uaFamiliesOf", () => {
  test("families for a desktop browser, Unknown fallbacks otherwise", () => {
    const chrome = uaFamiliesOf(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    );
    expect(chrome).toEqual({ browser: "Chrome", os: "Windows", device: "desktop", bot: false });
    expect(uaFamiliesOf(null)).toEqual({
      browser: "Unknown",
      os: "Unknown",
      device: "other",
      bot: false,
    });
  });

  test("bots are flagged", () => {
    expect(uaFamiliesOf("Googlebot/2.1 (+http://www.google.com/bot.html)").bot).toBe(true);
    expect(uaFamiliesOf("curl/8.4.0").bot).toBe(true);
  });
});

describe("language / screen width", () => {
  test("language is lowercased and capped at 8", () => {
    expect(languageOf("en-GB")).toBe("en-gb");
    expect(languageOf("zh-Hans-CN-x-priv")).toBe("zh-hans-");
    expect(languageOf("x")).toBeNull();
    expect(languageOf(undefined)).toBeNull();
  });

  test("screen width clamps to smallint", () => {
    expect(screenWidthOf(1440)).toBe(1440);
    expect(screenWidthOf(0)).toBe(0);
    expect(screenWidthOf(999_999)).toBe(32_767);
    expect(screenWidthOf(undefined)).toBeNull();
  });
});

describe("exclude-path globs", () => {
  test("* matches one segment, ** matches any depth", () => {
    expect(matchesExcludePath(["/admin/*"], "/admin/users")).toBe(true);
    expect(matchesExcludePath(["/admin/*"], "/admin/users/42")).toBe(false);
    expect(matchesExcludePath(["/admin/**"], "/admin/users/42")).toBe(true);
    expect(matchesExcludePath(["/admin/**"], "/admin")).toBe(true);
    expect(matchesExcludePath(["/admin/**"], "/administrator")).toBe(false);
  });

  test("exact patterns, multiple patterns, and regex specials are literal", () => {
    expect(matchesExcludePath(["/health"], "/health")).toBe(true);
    expect(matchesExcludePath(["/health"], "/healthz")).toBe(false);
    expect(matchesExcludePath(["/a", "/b/*"], "/b/c")).toBe(true);
    expect(matchesExcludePath(["/file.txt"], "/fileatxt")).toBe(false);
  });

  test("empty pattern lists never match; compile returns null", () => {
    expect(matchesExcludePath([], "/anything")).toBe(false);
    expect(compileExcludePaths([])).toBeNull();
    expect(compileExcludePaths(["", "  "])).toBeNull();
  });

  test("patterns without a leading slash are rooted", () => {
    expect(matchesExcludePath(["drafts/**"], "/drafts/a/b")).toBe(true);
  });
});
