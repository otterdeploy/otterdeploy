/**
 * The Cloudflare DNS client and the Infisical / Doppler secret providers
 * against a local stand-in for each API: `fetch` is replaced by a small fake
 * that answers the way each provider documents (envelopes, error bodies,
 * Retry-After). The product's own request building, parsing and error
 * reporting run unchanged.
 *
 *   - an account-owned Cloudflare token (which `/user/tokens/verify` rejects)
 *     is accepted when it can reach its zones, and a 429 says how long the
 *     token is blocked;
 *   - Infisical references are expanded, imports included, and one login
 *     serves many reads; Infisical's own message is kept;
 *   - a Doppler token that is not a service token must name its project and
 *     config, Doppler's reserved names are not offered, and a 429 reads as a
 *     rate limit, not a configuration problem.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { VaultProviderRuntime } from "../vault/types";

import { listCloudflareZones, verifyCloudflareToken } from "../cloudflare";
import { dopplerGetSecrets, dopplerListSecretNames, dopplerTest } from "../vault/doppler";
import { infisicalGetSecrets, infisicalTest } from "../vault/infisical";

const USER_TOKEN = "cloudflare-user-token";
const ACCOUNT_TOKEN = "cloudflare-account-token";
const DEAD_ACCOUNT_TOKEN = "cloudflare-disabled-account-token";
const ZONE = { id: "00000000000000000000000000000001", name: "example.test", status: "active" };

const INFISICAL_URL = "https://infisical.example.test";
const INFISICAL_CLIENT = "infisical-client-id";
const INFISICAL_SECRET = "infisical-client-secret";
const INFISICAL_PROJECT = "infisical-project";

const DOPPLER_SERVICE = "dp.st.dev.service-token";
const DOPPLER_PERSONAL = "dp.pt.personal-token";

interface Seen {
  url: URL;
  method: string;
  authorization: string | null;
}

const seen: Seen[] = [];
/** Answers queued ahead of the default fake, per host. */
const queued = new Map<string, Response[]>();

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const cloudflareError = (code: number, message: string) => ({
  success: false,
  errors: [{ code, message }],
  messages: [],
  result: null,
});

function cloudflare(request: Seen): Response {
  const token = request.authorization?.replace(/^Bearer /, "") ?? "";
  if (request.url.pathname.endsWith("/user/tokens/verify")) {
    // Account-owned tokens are not user tokens: Cloudflare answers 1000.
    if (token !== USER_TOKEN) return json(401, cloudflareError(1000, "Invalid API Token"));
    return json(200, { success: true, errors: [], result: { id: "tok", status: "active" } });
  }
  if (request.url.pathname.endsWith("/zones")) {
    if (token === DEAD_ACCOUNT_TOKEN) return json(401, cloudflareError(1000, "Invalid API Token"));
    return json(200, {
      success: true,
      errors: [],
      result: [ZONE],
      result_info: { page: 1, per_page: 50, total_pages: 1 },
    });
  }
  return json(404, cloudflareError(7003, "No route for that URI"));
}

function infisical(request: Seen): Response {
  if (request.url.pathname === "/api/v1/auth/universal-auth/login")
    return json(200, { accessToken: "infisical-access", expiresIn: 7200, tokenType: "Bearer" });
  if (request.url.pathname !== "/api/v3/secrets/raw") return json(404, { message: "Not found" });
  if (request.authorization !== "Bearer infisical-access")
    return json(401, { message: "Token invalid" });
  const params = request.url.searchParams;
  if (params.get("secretPath") !== "/")
    return json(404, {
      message: `Folder with path '${params.get("secretPath")}' in environment '${params.get("environment")}' was not found`,
    });
  const expand = params.get("expandSecretReferences") === "true";
  return json(200, {
    secrets: [
      { secretKey: "HOST", secretValue: "db.internal" },
      {
        secretKey: "DATABASE_URL",
        secretValue: expand
          ? "postgres://app@db.internal:5432/app"
          : "postgres://app@${HOST}:5432/app",
      },
    ],
    imports:
      params.get("include_imports") === "true"
        ? [{ secretPath: "/shared", secrets: [{ secretKey: "SHARED_KEY", secretValue: "shared" }] }]
        : undefined,
  });
}

function doppler(request: Seen): Response {
  const token = request.authorization?.replace(/^Bearer /, "") ?? "";
  if (!token.startsWith("dp.st.") && !request.url.searchParams.get("project"))
    return json(400, { messages: ["You must specify a project"], success: false });
  return json(200, {
    API_KEY: "secret-value",
    DOPPLER_PROJECT: "app",
    DOPPLER_ENVIRONMENT: "dev",
    DOPPLER_CONFIG: "dev",
  });
}

const fakes = new Map<string, (request: Seen) => Response>([
  ["api.cloudflare.com", cloudflare],
  ["infisical.example.test", infisical],
  ["api.doppler.com", doppler],
]);

const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
  const request: Seen = {
    url,
    method: init?.method ?? "GET",
    authorization: headers.get("authorization"),
  };
  seen.push(request);
  const next = queued.get(url.hostname)?.shift();
  if (next) return next;
  const fake = fakes.get(url.hostname);
  if (!fake) throw new TypeError(`fetch failed: no route to ${url.hostname}`);
  return fake(request);
});

function queue(host: string, ...responses: Response[]) {
  queued.set(host, [...(queued.get(host) ?? []), ...responses]);
}

function requestsTo(host: string, path?: string): Seen[] {
  return seen.filter((r) => r.url.hostname === host && (!path || r.url.pathname === path));
}

beforeAll(() => {
  vi.stubGlobal("fetch", fakeFetch);
});

afterEach(() => {
  seen.length = 0;
  queued.clear();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("Cloudflare", () => {
  it("verifies a user token", async () => {
    const verified = await verifyCloudflareToken(USER_TOKEN);
    expect(verified.isOk() && verified.value.active).toBe(true);
  });

  it("accepts an account-owned token that can reach its zones", async () => {
    const verified = await verifyCloudflareToken(ACCOUNT_TOKEN);
    expect(verified.isOk() && verified.value.active).toBe(true);
    const zones = await listCloudflareZones(ACCOUNT_TOKEN);
    expect(zones.isOk() && zones.value.map((zone) => zone.name)).toEqual([ZONE.name]);
  });

  it("still rejects an account-owned token that cannot", async () => {
    const verified = await verifyCloudflareToken(DEAD_ACCOUNT_TOKEN);
    expect(verified.isErr() && verified.error.message).toBe("Invalid API Token");
  });

  it("a 429 says how long the token is blocked", async () => {
    queue(
      "api.cloudflare.com",
      json(
        429,
        cloudflareError(
          10000,
          "Rate limited. Please wait and consider throttling your request speed",
        ),
        {
          "retry-after": "300",
        },
      ),
    );
    const zones = await listCloudflareZones(USER_TOKEN);
    expect(zones.isErr() && zones.error.message).toContain("retry after 300s");
  });

  it("every call carries a deadline", async () => {
    await listCloudflareZones(USER_TOKEN);
    const init = fakeFetch.mock.lastCall?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("Infisical", () => {
  const provider = (secretPath?: string, credential = INFISICAL_SECRET): VaultProviderRuntime => ({
    name: "infisical",
    kind: "infisical",
    config: {
      siteUrl: INFISICAL_URL,
      clientId: INFISICAL_CLIENT,
      projectId: INFISICAL_PROJECT,
      environmentSlug: "prod",
      ...(secretPath ? { secretPath } : {}),
    },
    credential,
  });

  it("expands secret references the way Infisical does, imports included", async () => {
    const secrets = await infisicalGetSecrets(provider(), ["DATABASE_URL", "SHARED_KEY"]);
    expect(secrets.get("DATABASE_URL")).toBe("postgres://app@db.internal:5432/app");
    expect(secrets.get("SHARED_KEY")).toBe("shared");
  });

  it("logs in once and reuses the access token", async () => {
    // A credential no other test used: nothing cached for it yet.
    const fresh = () => provider(undefined, "infisical-client-secret-fresh");
    await infisicalTest(fresh());
    await infisicalTest(fresh());
    await infisicalGetSecrets(fresh(), ["HOST"]);
    expect(requestsTo("infisical.example.test", "/api/v1/auth/universal-auth/login")).toHaveLength(
      1,
    );
    expect(requestsTo("infisical.example.test", "/api/v3/secrets/raw")).toHaveLength(3);
  });

  it("says what Infisical said when the folder does not exist", async () => {
    await expect(infisicalTest(provider("/web"))).rejects.toThrow("Folder with path '/web'");
  });
});

describe("Doppler", () => {
  const provider = (credential: string, config = {}): VaultProviderRuntime => ({
    name: "doppler",
    kind: "doppler",
    config,
    credential,
  });

  it("a service token reads its config; the picker hides Doppler's reserved names", async () => {
    expect(await dopplerListSecretNames(provider(DOPPLER_SERVICE))).toEqual(["API_KEY"]);
    expect((await dopplerGetSecrets(provider(DOPPLER_SERVICE), ["API_KEY"])).get("API_KEY")).toBe(
      "secret-value",
    );
  });

  it("a personal token without project and config is refused before any call", async () => {
    await expect(dopplerTest(provider(DOPPLER_PERSONAL))).rejects.toThrow("not a service token");
    expect(requestsTo("api.doppler.com")).toEqual([]);
  });

  it("a personal token with project and config reads that config", async () => {
    await dopplerTest(provider(DOPPLER_PERSONAL, { dopplerProject: "app", dopplerConfig: "dev" }));
    const params = requestsTo("api.doppler.com")[0]?.url.searchParams;
    expect(params?.get("project")).toBe("app");
    expect(params?.get("config")).toBe("dev");
  });

  it("a 429 is reported as a rate limit, not a configuration problem", async () => {
    queue(
      "api.doppler.com",
      json(429, { messages: ["Too many requests"] }, { "retry-after": "60" }),
    );
    await expect(dopplerTest(provider(DOPPLER_SERVICE))).rejects.toThrow(
      "rate limited by the provider; retry after 60s",
    );
  });

  it("keeps Doppler's own message on a refusal", async () => {
    queue("api.doppler.com", json(400, { messages: ["You must specify a project"] }));
    await expect(dopplerTest(provider(DOPPLER_SERVICE))).rejects.toThrow(
      "You must specify a project",
    );
  });
});
