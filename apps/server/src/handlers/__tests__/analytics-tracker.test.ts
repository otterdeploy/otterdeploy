import { Hono } from "hono";
import { describe, expect, test } from "vite-plus/test";

import { handleTrackerScript } from "../analytics/tracker";

const app = new Hono().get("/a/otter.js", handleTrackerScript);

describe("handleTrackerScript", () => {
  test("serves cacheable, sniff-proof, cross-origin JavaScript with an ETag", async () => {
    const res = await app.request("/a/otter.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]+"$/);
    expect(await res.text()).toContain("otter");
  });

  test("answers 304 to a matching If-None-Match", async () => {
    const first = await app.request("/a/otter.js");
    const etag = first.headers.get("etag") ?? "";
    const weak = await app.request("/a/otter.js", {
      headers: { "if-none-match": `W/${etag}, "other"` },
    });
    expect(weak.status).toBe(304);
    expect(weak.headers.get("etag")).toBe(etag);
    const miss = await app.request("/a/otter.js", { headers: { "if-none-match": '"stale"' } });
    expect(miss.status).toBe(200);
  });
});
