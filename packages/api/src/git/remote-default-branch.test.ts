import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// Same seam inspect-github.test.ts stubs: ghFetch routes through the shared
// egress policy, so a mocked egressFetch keeps this a pure unit test.
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

import {
  EgressPolicyError,
  egressFetch,
  type EgressResponse,
} from "@otterdeploy/shared/egress-policy";

import {
  parseAdvertisedHead,
  parseLsRefsHead,
  resolveRemoteDefaultBranch,
} from "./remote-default-branch";

function reply(body: string, status = 200): EgressResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "https://github.com/",
    headers: { get: () => null },
    text: async () => body,
    json: async (): Promise<unknown> => JSON.parse(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

// Captured from the real remotes (2026-10-09).
const WHOAMI_V2 =
  "00521ce75d01b6978863647da42557a707a479da3a51 HEAD symref-target:refs/heads/master\n0000";
const WHOAMI_V0 =
  "001e# service=git-upload-pack\n0000015b1ce75d01b6978863647da42557a707a479da3a51 HEAD\0multi_ack thin-pack side-band no-done symref=HEAD:refs/heads/master filter object-format=sha1 agent=git/github\n";

describe("resolveRemoteDefaultBranch", () => {
  const fetchMock = vi.mocked(egressFetch);
  beforeEach(() => fetchMock.mockReset());

  it("reads HEAD's target from a protocol-v2 ls-refs reply", async () => {
    fetchMock.mockResolvedValueOnce(reply(WHOAMI_V2));

    expect(await resolveRemoteDefaultBranch("https://github.com/traefik/whoami.git")).toBe(
      "master",
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://github.com/traefik/whoami.git/git-upload-pack");
    expect(init?.method).toBe("POST");
    expect(init?.headers?.["Git-Protocol"]).toBe("version=2");
    expect(String(init?.body)).toContain("command=ls-refs");
  });

  it("falls back to the v0 ref advertisement when v2 is refused", async () => {
    fetchMock.mockResolvedValueOnce(reply("", 400)).mockResolvedValueOnce(reply(WHOAMI_V0));

    expect(await resolveRemoteDefaultBranch("https://git.example.com/o/r.git")).toBe("master");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://git.example.com/o/r.git/info/refs?service=git-upload-pack",
    );
  });

  it("is null, never a throw, when the remote cannot be asked", async () => {
    fetchMock
      .mockRejectedValueOnce(new EgressPolicyError("non-public address"))
      .mockRejectedValueOnce(new EgressPolicyError("non-public address"));

    expect(await resolveRemoteDefaultBranch("https://github.com/o/r.git")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("is null when the reply names no HEAD (not a git host, empty repo)", async () => {
    fetchMock.mockResolvedValueOnce(reply("<html>hi</html>")).mockResolvedValueOnce(reply("0000"));

    expect(await resolveRemoteDefaultBranch("https://example.com/o/r.git")).toBeNull();
  });

  it("parses branch names with slashes and rejects garbage", () => {
    expect(parseLsRefsHead("0000abc HEAD symref-target:refs/heads/release/2.x\n")).toBe(
      "release/2.x",
    );
    expect(parseAdvertisedHead("x\0symref=HEAD:refs/heads/trunk agent=x")).toBe("trunk");
    expect(parseLsRefsHead("abc HEAD symref-target:refs/heads/a:b\n")).toBeNull();
    expect(parseLsRefsHead("abc HEAD\n")).toBeNull();
  });
});
