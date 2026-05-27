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
    // Flip one character of the ciphertext segment.
    const [v, n, last] = ct.split(".") as [string, string, string];
    const tampered = `${v}.${n}.${last.replace(/.$/, last.endsWith("A") ? "B" : "A")}`;
    await expect(decryptSecret(tampered)).rejects.toThrow();
  });

  it("rejects malformed input", async () => {
    await expect(decryptSecret("not-a-blob")).rejects.toThrow(/malformed/);
    await expect(decryptSecret("v2.x.y")).rejects.toThrow(/version/);
  });
});
