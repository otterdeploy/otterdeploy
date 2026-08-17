import { beforeEach, describe, expect, test } from "vite-plus/test";

import { __resetUaMemo, classifyUa } from "../analytics-ua";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const EDGE_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const FIREFOX_ANDROID_TABLET =
  "Mozilla/5.0 (Android 14; Tablet; rv:126.0) Gecko/126.0 Firefox/126.0";

beforeEach(() => {
  __resetUaMemo();
});

describe("classifyUa", () => {
  test("browsers resolve family, os, and device type", () => {
    expect(classifyUa(CHROME_MAC)).toEqual({
      browser: "Chrome",
      os: "macOS",
      deviceType: "desktop",
      bot: false,
    });
    expect(classifyUa(SAFARI_IPHONE)).toEqual({
      browser: "Safari",
      os: "iOS",
      deviceType: "mobile",
      bot: false,
    });
    // Edge embeds Chrome/ and Safari/: most specific must win.
    expect(classifyUa(EDGE_WIN).browser).toBe("Edge");
    expect(classifyUa(FIREFOX_ANDROID_TABLET)).toEqual({
      browser: "Firefox",
      os: "Android",
      deviceType: "tablet",
      bot: false,
    });
  });

  test("CLI tools are bots", () => {
    expect(classifyUa("curl/8.4.0").bot).toBe(true);
    expect(classifyUa("python-requests/2.32.0").bot).toBe(true);
    expect(classifyUa("Go-http-client/2.0").bot).toBe(true);
    expect(classifyUa("curl/8.4.0").deviceType).toBe("bot");
  });

  test("known crawlers and generic bot tokens are bots", () => {
    expect(
      classifyUa("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)").bot,
    ).toBe(true);
    expect(classifyUa("Mozilla/5.0 (compatible; FooBot/1.0)").bot).toBe(true);
    expect(classifyUa("GPTBot/1.0").bot).toBe(true);
  });

  test("the generic bot hint never fires on a real browser UA", () => {
    expect(classifyUa(CHROME_MAC).bot).toBe(false);
    // "Botswana" style substrings: (?![a-z]) guards the right edge only, so a
    // token ENDING in bot matches but "botanical" does not.
    expect(classifyUa("botanical-garden-client").bot).toBe(false);
  });

  test("empty and unknown agents are other, not bots", () => {
    expect(classifyUa("")).toEqual({ browser: null, os: null, deviceType: "other", bot: false });
    expect(classifyUa("SomethingNobodyKnows").deviceType).toBe("other");
  });
});
