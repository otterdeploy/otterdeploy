/**
 * Channel-aware release resolution (release-channels design, od-tfs2).
 *
 * The load-bearing behaviors: stable reads `releases/latest` (GitHub already
 * excludes prereleases there); nightly reads the releases LIST and takes its
 * greatest semantic version — prerelease OR stable, so GitHub's non-semver
 * ordering cannot hide a same-day re-cut and a newer stable is offered to
 * nightly users (the channel catch-up point). Every failure resolves to null.
 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { fetchLatestRelease, parseUpdateChannel } from "./release-source";

function stubFetch(handler: (url: string) => { status?: number; json?: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { status = 200, json = {} } = handler(url);
      return new Response(JSON.stringify(json), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseUpdateChannel", () => {
  it("normalizes anything unrecognized to stable", () => {
    expect(parseUpdateChannel("stable")).toBe("stable");
    expect(parseUpdateChannel("nightly")).toBe("nightly");
    expect(parseUpdateChannel("beta")).toBe("stable");
    expect(parseUpdateChannel(null)).toBe("stable");
    expect(parseUpdateChannel(undefined)).toBe("stable");
  });
});

describe("fetchLatestRelease", () => {
  it("stable hits releases/latest and maps the payload", async () => {
    stubFetch((url) => {
      expect(url).toContain("/releases/latest");
      return {
        json: { tag_name: "v0.15.2", html_url: "https://x/rel", body: "notes" },
      };
    });
    expect(await fetchLatestRelease("stable")).toEqual({
      version: "v0.15.2",
      notes: "notes",
      url: "https://x/rel",
    });
  });

  it("nightly takes the greatest version even when GitHub returns .9 before .14", async () => {
    stubFetch((url) => {
      expect(url).toContain("/releases?per_page=100");
      return {
        json: [
          { tag_name: "v0.20.0-nightly.20260831.9", html_url: "https://x/n9", body: "n9" },
          {
            tag_name: "v0.20.0-nightly.20260831.14",
            html_url: "https://x/n14",
            body: "n14",
          },
          { tag_name: "v0.15.2", html_url: "https://x/s", body: "s" },
        ],
      };
    });
    expect(await fetchLatestRelease("nightly")).toEqual({
      version: "v0.20.0-nightly.20260831.14",
      notes: "n14",
      url: "https://x/n14",
    });
  });

  it("nightly takes a stable release when it is the greatest version (channel catch-up)", async () => {
    stubFetch(() => ({
      json: [
        { tag_name: "v0.16.0-nightly.20260821", html_url: "https://x/n", body: "n" },
        { tag_name: "v0.16.0", html_url: "https://x/s", body: "stable!" },
      ],
    }));
    const release = await fetchLatestRelease("nightly");
    expect(release?.version).toBe("v0.16.0");
  });

  it("nightly skips unparseable tags rather than offering them", async () => {
    stubFetch(() => ({
      json: [
        { tag_name: "untagged-experiment", html_url: null, body: null },
        { tag_name: "v0.16.0-nightly.20260820", html_url: null, body: null },
      ],
    }));
    const release = await fetchLatestRelease("nightly");
    expect(release?.version).toBe("v0.16.0-nightly.20260820");
  });

  it("resolves null on non-2xx, garbage payloads, and network errors (never throws)", async () => {
    stubFetch(() => ({ status: 500 }));
    expect(await fetchLatestRelease("stable")).toBeNull();
    expect(await fetchLatestRelease("nightly")).toBeNull();

    stubFetch(() => ({ json: { nope: true } }));
    expect(await fetchLatestRelease("stable")).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await fetchLatestRelease("nightly")).toBeNull();
  });
});
