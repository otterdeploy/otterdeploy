import { describe, expect, test } from "bun:test";

import { artifactCacheKey } from "./cache-key";

describe("artifactCacheKey", () => {
  test("strips attacker-controlled query parameters", () => {
    const key = artifactCacheKey(
      new Request("https://get.otterdeploy.com/v0.20.0/install.sh?nonce=random#ignored"),
    );

    expect(key.url).toBe("https://get.otterdeploy.com/v0.20.0/install.sh");
    expect(key.method).toBe("GET");
  });

  test("lets HEAD share the same cache entry as GET", () => {
    const get = artifactCacheKey(new Request("https://get.otterdeploy.com/install.sh"));
    const head = artifactCacheKey(
      new Request("https://get.otterdeploy.com/install.sh?download=1", { method: "HEAD" }),
    );

    expect(head.url).toBe(get.url);
    expect(head.method).toBe(get.method);
  });

  test("keeps validators and ranges that Cache.match evaluates", () => {
    const key = artifactCacheKey(
      new Request("https://get.otterdeploy.com/install.sh?nonce=random", {
        headers: {
          "If-Modified-Since": "Thu, 03 Sep 2026 10:00:00 GMT",
          "If-None-Match": '"release-etag"',
          Range: "bytes=0-99",
          "User-Agent": "must not fragment the cache",
        },
      }),
    );

    expect(Object.fromEntries(key.headers)).toEqual({
      "if-modified-since": "Thu, 03 Sep 2026 10:00:00 GMT",
      "if-none-match": '"release-etag"',
      range: "bytes=0-99",
    });
  });
});
