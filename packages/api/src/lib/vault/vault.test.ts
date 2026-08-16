/**
 * Provider-client tests — fixture JSON through the real zod response
 * schemas, no live HTTP (global fetch is stubbed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { VaultProviderRuntime } from "./types";

import { dopplerGetSecrets } from "./doppler";
import {
  hashicorpGetSecrets,
  hashicorpListSecretNames,
  splitHashicorpRef,
} from "./hashicorp";
import { infisicalGetSecrets, infisicalListSecretNames } from "./infisical";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const requestUrl = (call: number): string => String(fetchMock.mock.calls[call]?.[0] ?? "");

describe("hashicorp (KV v2)", () => {
  const provider: VaultProviderRuntime = {
    name: "hv",
    kind: "hashicorp",
    config: { url: "https://vault.local:8200/", mount: "secret", namespace: "team-a" },
    credential: "hvs.token",
  };

  it("splits refs on the LAST colon", () => {
    expect(splitHashicorpRef("hv", "a:b:c")).toEqual({ path: "a:b", field: "c" });
    expect(() => splitHashicorpRef("hv", "no-colon")).toThrow(/<path>:<field>/);
    expect(() => splitHashicorpRef("hv", ":field")).toThrow();
    expect(() => splitHashicorpRef("hv", "path:")).toThrow();
  });

  it("batches fields of one path into a single read and stringifies non-strings", async () => {
    fetchMock.mockResolvedValue(json({ data: { data: { password: "pw", port: 5432 } } }));

    const out = await hashicorpGetSecrets(provider, ["app/db:password", "app/db:port"]);
    expect(out.get("app/db:password")).toBe("pw");
    expect(out.get("app/db:port")).toBe("5432");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestUrl(0)).toBe("https://vault.local:8200/v1/secret/data/app/db");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      "X-Vault-Token": "hvs.token",
      "X-Vault-Namespace": "team-a",
    });
  });

  it("errors with provider name when the field is missing", async () => {
    fetchMock.mockResolvedValue(json({ data: { data: { user: "u" } } }));
    await expect(hashicorpGetSecrets(provider, ["app/db:password"])).rejects.toThrow(
      /"hv".*no field "password"/,
    );
  });

  it("surfaces the HTTP status without echoing the credential", async () => {
    fetchMock.mockResolvedValue(json({ errors: ["permission denied"] }, 403));
    const failure = hashicorpGetSecrets(provider, ["app/db:password"]);
    await expect(failure).rejects.toThrow(/HTTP 403/);
    await expect(hashicorpGetSecrets(provider, ["app/db:password"])).rejects.not.toThrow(
      /hvs\.token/,
    );
  });

  it("recursively lists secret paths via the metadata endpoint", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/metadata/app/")) return json({ data: { keys: ["db", "cache"] } });
      if (url.includes("/metadata/?list=true")) return json({ data: { keys: ["app/", "top"] } });
      return json({ errors: [] }, 404);
    });

    const names = await hashicorpListSecretNames(provider);
    expect(names).toEqual(["app/db", "app/cache", "top"]);
  });
});

describe("infisical", () => {
  const provider: VaultProviderRuntime = {
    name: "inf",
    kind: "infisical",
    config: {
      clientId: "machine-id",
      projectId: "proj_1",
      environmentSlug: "prod",
      secretPath: "/backend",
    },
    credential: "client-secret",
  };

  const stubHappyPath = () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/auth/universal-auth/login")) {
        return json({ accessToken: "jwt-token" });
      }
      if (url.includes("/api/v3/secrets/raw")) {
        return json({
          secrets: [
            { secretKey: "DATABASE_URL", secretValue: "postgres://x" },
            { secretKey: "API_KEY", secretValue: "k" },
          ],
        });
      }
      return json({}, 404);
    });
  };

  it("logs in with Universal Auth then maps secret keys", async () => {
    stubHappyPath();
    const out = await infisicalGetSecrets(provider, ["DATABASE_URL"]);
    expect(out.get("DATABASE_URL")).toBe("postgres://x");

    // One login + one raw fetch, in that order, scoped to the config.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestUrl(0)).toContain("https://app.infisical.com/api/v1/auth/universal-auth/login");
    expect(requestUrl(1)).toContain("workspaceId=proj_1");
    expect(requestUrl(1)).toContain("environment=prod");
    expect(requestUrl(1)).toContain("secretPath=%2Fbackend");
  });

  it("errors on a key the environment doesn't hold", async () => {
    stubHappyPath();
    await expect(infisicalGetSecrets(provider, ["MISSING"])).rejects.toThrow(
      /"inf".*no secret named "MISSING"/,
    );
  });

  it("lists the environment's secret keys", async () => {
    stubHappyPath();
    expect(await infisicalListSecretNames(provider)).toEqual(["DATABASE_URL", "API_KEY"]);
  });
});

describe("doppler", () => {
  const provider: VaultProviderRuntime = {
    name: "dp",
    kind: "doppler",
    config: { dopplerProject: "backend", dopplerConfig: "prd" },
    credential: "dp.st.token",
  };

  it("downloads the config once and stringifies non-string values", async () => {
    fetchMock.mockResolvedValue(json({ API_KEY: "k", FLAGS: { beta: true } }));

    const out = await dopplerGetSecrets(provider, ["API_KEY", "FLAGS"]);
    expect(out.get("API_KEY")).toBe("k");
    expect(out.get("FLAGS")).toBe('{"beta":true}');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestUrl(0)).toContain("format=json");
    expect(requestUrl(0)).toContain("project=backend");
    expect(requestUrl(0)).toContain("config=prd");
  });

  it("errors on a key the config doesn't hold", async () => {
    fetchMock.mockResolvedValue(json({ API_KEY: "k" }));
    await expect(dopplerGetSecrets(provider, ["NOPE"])).rejects.toThrow(
      /"dp".*no secret named "NOPE"/,
    );
  });
});
