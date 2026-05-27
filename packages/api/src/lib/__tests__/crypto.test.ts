import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "../crypto";

describe("encryptSecret/decryptSecret", () => {
  it("round-trips arbitrary strings", async () => {
    const inputs = [
      "",
      "hello",
      "ghp_abcdef0123456789",
      "🦦 unicode + emoji",
      "x".repeat(4096),
    ];
    for (const input of inputs) {
      const ct = await encryptSecret(input);
      expect(ct).toMatch(/^v1\./);
      if (input.length > 4) expect(ct).not.toContain(input);
      const round = await decryptSecret(ct);
      expect(round).toBe(input);
    }
  });

  it("produces different ciphertext for the same plaintext (random nonce)", async () => {
    const a = await encryptSecret("same");
    const b = await encryptSecret("same");
    expect(a).not.toBe(b);
    expect(await decryptSecret(a)).toBe("same");
    expect(await decryptSecret(b)).toBe("same");
  });

  it("rejects tampered ciphertext", async () => {
    const ct = await encryptSecret("secret");
    // Flip many characters mid-ciphertext so the GCM tag can't possibly
    // still verify. One-char flips have a ~1/2^16 chance of landing on a
    // valid tag through luck — too flaky for CI.
    const [v, n, last] = ct.split(".") as [string, string, string];
    const mid = Math.floor(last.length / 2);
    const tampered = `${v}.${n}.${last.slice(0, mid)}AAAA${last.slice(mid + 4)}`;
    await expect(decryptSecret(tampered)).rejects.toThrow();
  });

  it("rejects malformed input", async () => {
    await expect(decryptSecret("not-a-blob")).rejects.toThrow(/malformed/);
    await expect(decryptSecret("v2.x.y")).rejects.toThrow(/version/);
  });
});
