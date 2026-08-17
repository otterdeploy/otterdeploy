import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The write-back helpers mint a real App JWT (crypto.subtle) before hitting the
// network, so the config loader must return a genuine PKCS8 key. Generated
// once below. Only the HTTP layer (egressFetch, via ghFetch) is mocked,
// exercising URL/method/body.
vi.mock("./github-app-config", () => ({
  loadGithubAppForInstallation: vi.fn(),
}));
// github-app.ts's `ghFetch` wrapper routes every request through the shared
// egress policy (SSRF hardening): stub both the network call and the
// control-plane-identity denylist lookup (a DB read) so this stays a pure
// unit test.
vi.mock("@otterdeploy/shared/egress-policy", () => ({
  egressFetch: vi.fn(),
  EgressPolicyError: class EgressPolicyError extends Error {},
}));
vi.mock("../lib/egress-denylist", () => ({
  controlPlaneEgressDenylist: vi.fn().mockResolvedValue({ blockedHosts: [], blockedAddresses: [] }),
}));
vi.mock("../lib/egress-options", () => ({
  egressAllowlist: () => [],
}));

import type { EgressResponse } from "@otterdeploy/shared/egress-policy";

import { egressFetch } from "@otterdeploy/shared/egress-policy";

import { createCommitStatus, PR_COMMENT_MARKER, upsertPrComment } from "./github-app";
import { loadGithubAppForInstallation } from "./github-app-config";

/** A real RSASSA-PKCS1-v1_5 private key, PEM-encoded, so mintAppJwt succeeds. */
async function generateTestPem(): Promise<string> {
  const kp = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  if (!("privateKey" in kp)) throw new Error("expected an RSA key pair, got a single key");
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  let bin = "";
  for (const b of new Uint8Array(pkcs8)) bin += String.fromCharCode(b);
  const lines = (btoa(bin).match(/.{1,64}/g) ?? []).join("\n");
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}

let TEST_PEM = "";

function jsonResponse(body: unknown, ok = true, status = 200): EgressResponse {
  return {
    ok,
    status,
    url: "https://api.github.com/",
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

// The token exchange (POST /app/installations/:id/access_tokens) is the first
// call getInstallationToken makes; every helper triggers it once.
function tokenResponse(): EgressResponse {
  return jsonResponse({ token: "ghs_test", expires_at: "2099-01-01T00:00:00Z" });
}

interface FetchCall {
  0: string;
  1: { method: string; body: string; headers: Record<string, string> };
}

describe("github write-back", () => {
  const fetchMock = vi.mocked(egressFetch);

  // Narrow the recorded call to the shape the assertions read. Throwing on a
  // mismatch fails the test the same way the old blind cast's expects would.
  const nthCall = (n: number): FetchCall => {
    const c = fetchMock.mock.calls[n];
    if (!c) throw new Error(`expected a fetch call #${n}`);
    const [url, init] = c;
    if (typeof url !== "string") throw new Error(`expected a string URL in call #${n}`);
    const { method, body, headers } = init ?? {};
    if (typeof method !== "string" || typeof body !== "string" || headers === undefined) {
      throw new Error(`expected method/body/headers on call #${n}`);
    }
    return { 0: url, 1: { method, body, headers } };
  };

  beforeAll(async () => {
    TEST_PEM = await generateTestPem();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadGithubAppForInstallation).mockResolvedValue({
      appId: "123",
      privateKeyPem: TEST_PEM,
      apiBaseUrl: "https://api.github.com",
    });
  });

  it("createCommitStatus POSTs to the statuses endpoint with the mapped state", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse()) // installation token exchange
      .mockResolvedValueOnce(jsonResponse({})); // the status POST

    await createCommitStatus({
      installationId: "42",
      owner: "acme",
      repo: "app",
      sha: "deadbeef",
      state: "success",
      targetUrl: "https://pr-1.example.com",
      description: "Preview ready",
    });

    const statusCall = nthCall(1);
    expect(statusCall[0]).toBe("https://api.github.com/repos/acme/app/statuses/deadbeef");
    expect(statusCall[1].method).toBe("POST");
    const body = JSON.parse(statusCall[1].body);
    expect(body.state).toBe("success");
    expect(body.target_url).toBe("https://pr-1.example.com");
    expect(body.context).toBe("otterdeploy/preview");
  });

  it("upsertPrComment creates a new comment when none exists (marker prepended)", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse()) // token
      .mockResolvedValueOnce(jsonResponse([])) // list comments -> none marked
      .mockResolvedValueOnce(jsonResponse({ id: 1 })); // create

    await upsertPrComment({
      installationId: "42",
      owner: "acme",
      repo: "app",
      prNumber: 7,
      body: "Preview: https://pr-7.example.com",
    });

    const createCall = nthCall(2);
    expect(createCall[0]).toBe("https://api.github.com/repos/acme/app/issues/7/comments");
    expect(createCall[1].method).toBe("POST");
    expect(JSON.parse(createCall[1].body).body).toContain(PR_COMMENT_MARKER);
  });

  it("upsertPrComment PATCHes the existing marked comment", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse()) // token
      .mockResolvedValueOnce(jsonResponse([{ id: 99, body: `${PR_COMMENT_MARKER}\nold` }])) // list
      .mockResolvedValueOnce(jsonResponse({ id: 99 })); // patch

    await upsertPrComment({
      installationId: "42",
      owner: "acme",
      repo: "app",
      prNumber: 7,
      body: "Preview updated",
    });

    const patchCall = nthCall(2);
    expect(patchCall[0]).toBe("https://api.github.com/repos/acme/app/issues/comments/99");
    expect(patchCall[1].method).toBe("PATCH");
  });

  it("throws when GitHub rejects the status update", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ message: "nope" }, false, 422));

    await expect(
      createCommitStatus({
        installationId: "42",
        owner: "acme",
        repo: "app",
        sha: "x",
        state: "error",
      }),
    ).rejects.toThrow();
  });
});
