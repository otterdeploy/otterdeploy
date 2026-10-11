import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vite-plus/test";

import { buildJoinCommand, maskToken } from "./join-command";

const created = {
  id: "nen_0123456789abcdefghijk",
  credential: "nen_0123456789abcdefghijk.7Hq2xW9sK4mPzR1vB8nT",
  expiresAt: "2026-10-11T12:10:00.000Z",
};

describe("buildJoinCommand", () => {
  const command = buildJoinCommand("https://cp.example.com", created);

  it("is the short form: fetch install-node.sh, pass the token", () => {
    expect(command).toBe(
      "curl -fsSL https://cp.example.com/install-node.sh \\\n" +
        "  | sudo sh -s -- --token nen_0123456789abcdefghijk.7Hq2xW9sK4mPzR1vB8nT",
    );
  });

  it("runs as one command once pasted into sh, line break and all", () => {
    // Stand-ins for the network and for sudo: the fetched "script" echoes the
    // arguments sh hands it, which must be exactly `--token <token>`.
    const result = spawnSync(
      "sh",
      [
        "-c",
        `curl() { printf '%s\\n' "echo fetched \\"\\$1\\" from \\$*" ; }\nsudo() { "$@"; }\n${command}`,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(`fetched --token from --token ${created.credential}`);
  });
});

describe("maskToken", () => {
  it("keeps a recognisable prefix and hides the rest", () => {
    const masked = maskToken(created.credential);
    expect(masked.startsWith("nen_0123")).toBe(true);
    expect(masked).not.toContain("7Hq2");
  });
});
