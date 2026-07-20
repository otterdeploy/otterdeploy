import { describe, expect, mock, test } from "vite-plus/test";

/**
 * The device flow hands the CLI an absolute URL to open in a browser. Because
 * better-auth freezes that URL at module load from env (which defaults to
 * `http://<ip>:3000`), a control plane reached at a real domain would send
 * operators to a different origin, over http, with a port. These cover the
 * rebase that fixes it — including the failure modes, since a login that sends
 * you somewhere stale beats a login that 500s.
 */

const resolveCanonicalWebOrigin = mock(async () => "https://deploy.acme.com");
mock.module("@otterdeploy/auth/web-origin", () => ({ resolveCanonicalWebOrigin }));

const { withCanonicalDeviceOrigin } = await import("../device-origin");

const DEVICE_PATH = "/api/auth/device/code";

const deviceResponse = (body: Record<string, unknown>, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    ...init,
  });

const BODY = {
  device_code: "dev-code",
  user_code: "WDJB-MJHT",
  verification_uri: "http://10.0.0.4:3000/device",
  verification_uri_complete: "http://10.0.0.4:3000/device?user_code=WDJB-MJHT",
  expires_in: 1800,
  interval: 5,
};

describe("withCanonicalDeviceOrigin", () => {
  test("rebases both verification URLs onto the canonical origin, dropping the port", async () => {
    const out = await withCanonicalDeviceOrigin(DEVICE_PATH, deviceResponse(BODY));
    const json = (await out.json()) as Record<string, string>;

    expect(json.verification_uri).toBe("https://deploy.acme.com/device");
    expect(json.verification_uri_complete).toBe(
      "https://deploy.acme.com/device?user_code=WDJB-MJHT",
    );
  });

  test("preserves every other field and the plugin's headers", async () => {
    const out = await withCanonicalDeviceOrigin(DEVICE_PATH, deviceResponse(BODY));
    const json = (await out.json()) as Record<string, unknown>;

    expect(json.device_code).toBe("dev-code");
    expect(json.user_code).toBe("WDJB-MJHT");
    expect(json.expires_in).toBe(1800);
    expect(json.interval).toBe(5);
    // no-store matters: these URLs are single-use.
    expect(out.headers.get("cache-control")).toBe("no-store");
  });

  test("leaves other auth routes alone", async () => {
    const original = deviceResponse({ verification_uri: "http://10.0.0.4:3000/device" });
    const out = await withCanonicalDeviceOrigin("/api/auth/sign-in/email", original);
    expect(out).toBe(original);
  });

  test("leaves non-OK responses alone", async () => {
    const original = deviceResponse({ error: "invalid_client" }, { status: 400 });
    const out = await withCanonicalDeviceOrigin(DEVICE_PATH, original);
    expect(out).toBe(original);
  });

  test("passes through when the body carries no verification URLs", async () => {
    const original = deviceResponse({ device_code: "x" });
    const out = await withCanonicalDeviceOrigin(DEVICE_PATH, original);
    expect(out).toBe(original);
  });

  test("falls back to the original response when the origin lookup fails", async () => {
    resolveCanonicalWebOrigin.mockImplementationOnce(() => {
      throw new Error("db down");
    });
    const out = await withCanonicalDeviceOrigin(DEVICE_PATH, deviceResponse(BODY));
    const json = (await out.json()) as Record<string, string>;
    // Stale origin, but still a working login — not a 500.
    expect(json.verification_uri).toBe("http://10.0.0.4:3000/device");
  });
});
