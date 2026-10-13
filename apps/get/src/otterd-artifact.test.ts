import { describe, expect, test } from "bun:test";

import { otterdArtifact } from "./otterd-artifact";

describe("otterdArtifact", () => {
  test("names the release manifest and each node binary of one release", () => {
    expect(otterdArtifact("/otterd/v0.4.2/otterd-linux-x86_64")).toEqual({
      key: "otterd/v0.4.2/otterd-linux-x86_64",
      version: "v0.4.2",
      file: "otterd-linux-x86_64",
      contentType: "application/octet-stream",
    });
    expect(otterdArtifact("/otterd/v1.0.0-rc.1/release.json")?.contentType).toBe(
      "application/json; charset=utf-8",
    );
    for (const f of ["otterd-guard", "otterd-net", "otterd-dns", "otterd-recover"]) {
      expect(otterdArtifact(`/otterd/v0.4.2/${f}-linux-aarch64`)?.key).toBe(
        `otterd/v0.4.2/${f}-linux-aarch64`,
      );
    }
  });

  test("refuses anything that is not a pinned release file", () => {
    for (const p of [
      "/otterd/latest/otterd-linux-x86_64",
      "/otterd/0.4.2/otterd-linux-x86_64",
      "/otterd/v0.4.2/otterd-linux-arm64",
      "/otterd/v0.4.2/otterd",
      "/otterd/v0.4.2/../install.sh",
      "/otterd/v0.4.2/sub/otterd-linux-x86_64",
      "/otterd/release-keys.json",
      "/v0.4.2/otterd-linux-x86_64",
      "/otterd/v0.4.2/constructor",
    ]) {
      expect(otterdArtifact(p)).toBeNull();
    }
  });
});
