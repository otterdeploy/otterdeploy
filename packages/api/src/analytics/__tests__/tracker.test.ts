import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { COLLECT_PATH, TRACKER_PATH, buildSnippet, getTrackerScript } from "../tracker";
import { type FakeWindow, type Payload, makeFakeWindow, otterApi } from "./fake-window";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function boot(fake: FakeWindow): Promise<void> {
  const { body } = await getTrackerScript();
  // The served script resolves `window` lexically; handing it in as a
  // parameter runs the exact minified artifact against the fake graph.
  // oxlint-disable-next-line typescript/no-implied-eval -- evaluating the served tracker artifact is the point of this test; no jsdom here.
  new Function("window", body)(fake.w);
}

function events(fake: FakeWindow): Payload["e"] {
  return fake.requests.flatMap((r) => r.payload.e);
}

describe("buildSnippet", () => {
  test("emits the documented one-liner", () => {
    expect(buildSnippet("https://cp.example", "od_abc")).toBe(
      '<script async src="https://cp.example/a/otter.js" data-key="od_abc"></script>',
    );
    expect(buildSnippet("https://cp.example/", "od_abc")).toContain(
      'src="https://cp.example/a/otter.js"',
    );
    expect(TRACKER_PATH).toBe("/a/otter.js");
    expect(COLLECT_PATH).toBe("/a/c");
  });
});

describe("getTrackerScript", () => {
  test("returns stable, non-empty JS naming the API and the collect path", async () => {
    const first = await getTrackerScript();
    const second = await getTrackerScript();
    expect(first.body.length).toBeGreaterThan(1000);
    expect(first.body).toContain("otter");
    expect(first.body).toContain(COLLECT_PATH);
    expect(first.etag).toMatch(/^"[0-9a-f]+"$/);
    expect(second.etag).toBe(first.etag);
    expect(second.body).toBe(first.body);
  });
});

describe("otter.js behaviour", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("queues an initial pageview with url, referrer, title and flushes after 1 s", async () => {
    const fake = makeFakeWindow();
    await boot(fake);
    expect(fake.requests).toHaveLength(0);
    vi.advanceTimersByTime(1000);

    expect(fake.requests).toHaveLength(1);
    const [req] = fake.requests;
    expect(req?.url).toBe(`https://cp.example${COLLECT_PATH}`);
    expect(req?.via).toBe("fetch");
    expect(req?.contentType).toBe("text/plain");
    expect(req?.payload.k).toBe("od_test");
    expect(req?.payload.v).toBe(1);
    expect(req?.payload.sid).toMatch(UUID);
    expect(fake.w.sessionStorage.getItem("otter_sid")).toBe(req?.payload.sid);

    const pv = req?.payload.e[0];
    expect(pv).toMatchObject({
      t: "pv",
      u: "https://site.example/pricing?utm_source=x",
      r: "https://google.com/",
      ti: "Pricing",
      sw: 1440,
      l: "en-GB",
    });
    expect(pv?.id).toMatch(UUID);
    expect(typeof pv?.ts).toBe("number");
  });

  test("track() queues a validated custom event", async () => {
    const fake = makeFakeWindow();
    await boot(fake);
    const otter = otterApi(fake);
    otter.track("signup", {
      plan: "pro",
      seats: 3,
      beta: true,
      nested: { no: 1 },
      long: "x".repeat(300),
    });
    otter.track("", {});
    otter.track("y".repeat(65));
    otter.flush();

    const ev = events(fake).find((e) => e.t === "ev");
    expect(ev).toMatchObject({ n: "signup", u: "https://site.example/pricing?utm_source=x" });
    expect(ev?.p).toEqual({ plan: "pro", seats: 3, beta: true, long: "x".repeat(256) });
    expect(events(fake).filter((e) => e.t === "ev")).toHaveLength(1);
  });

  test("SPA navigation closes engagement and sends a new pageview; same URL is suppressed", async () => {
    const fake = makeFakeWindow();
    await boot(fake);
    fake.fire("pointerdown");
    vi.advanceTimersByTime(700);
    fake.w.history.pushState(null, "", "/docs?tab=1&utm_campaign=c");
    vi.advanceTimersByTime(0);
    fake.w.history.pushState(null, "", "/docs?tab=2&utm_campaign=c");
    vi.advanceTimersByTime(0);
    fake.w.history.replaceState(null, "", "/docs?utm_campaign=c");
    otterApi(fake).flush();

    const kinds = events(fake).map((e) => e.t);
    expect(kinds).toEqual(["pv", "eng", "pv"]);
    const [, eng, second] = events(fake);
    expect(eng).toMatchObject({ u: "https://site.example/pricing?utm_source=x", sc: 40 });
    expect(eng?.a).toBeGreaterThanOrEqual(700);
    expect(eng?.vis).toBeGreaterThanOrEqual(700);
    expect(second).toMatchObject({ t: "pv", u: "https://site.example/docs?utm_campaign=c" });
    expect(second?.r).toBeUndefined();
  });

  test("global privacy control sends nothing but leaves the API callable", async () => {
    const fake = makeFakeWindow({ gpc: true });
    await boot(fake);
    const otter = otterApi(fake);
    otter.track("signup");
    otter.flush();
    vi.advanceTimersByTime(5000);
    expect(fake.requests).toHaveLength(0);
    expect(fake.listeners.size).toBe(0);
  });

  test("#otter-ignore sets the localStorage flag and stops tracking", async () => {
    const fake = makeFakeWindow({ href: "https://site.example/#otter-ignore" });
    await boot(fake);
    otterApi(fake).flush();
    vi.advanceTimersByTime(2000);
    expect(fake.w.localStorage.getItem("otter_ignore")).toBe("1");
    expect(fake.requests).toHaveLength(0);
  });

  test("hide flushes engagement over sendBeacon; consent gate holds events", async () => {
    const fake = makeFakeWindow({ attrs: { "require-consent": "" } });
    await boot(fake);
    vi.advanceTimersByTime(3000);
    expect(fake.requests).toHaveLength(0);
    otterApi(fake).consent("granted");
    vi.advanceTimersByTime(1000);
    expect(events(fake).map((e) => e.t)).toEqual(["pv"]);

    fake.w.document.visibilityState = "hidden";
    fake.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(10);
    const beacon = fake.requests.at(-1);
    expect(beacon?.via).toBe("beacon");
    // Bun's Blob appends ";charset=utf-8" to the type; browsers keep it verbatim.
    expect(beacon?.contentType).toMatch(/^text\/plain\b/);
    expect(beacon?.payload.e.map((e) => e.t)).toEqual(["eng"]);
  });

  test("parks failed batches in sessionStorage and retries on the next flush", async () => {
    const fake = makeFakeWindow({ fetchStatus: 503 });
    await boot(fake);
    await vi.advanceTimersByTimeAsync(1000);
    const parked = fake.w.sessionStorage.getItem("otter_q");
    expect(parked).not.toBeNull();
    otterApi(fake).track("retry");
    otterApi(fake).flush();
    expect(fake.requests.at(-1)?.payload.e.map((e) => e.t)).toEqual(["pv", "ev"]);
  });
});
