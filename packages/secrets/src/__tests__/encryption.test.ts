import { describe, it, expect } from "vitest";
import { encrypt, decrypt, generateEncryptionKey } from "../encryption";

describe("encrypt / decrypt", () => {
  const key = generateEncryptionKey();

  it("round-trips plaintext through encrypt then decrypt", () => {
    const plaintext = "super-secret-value-123";
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);

    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertexts for the same plaintext (non-deterministic IV)", () => {
    const plaintext = "same-input-different-output";
    const a = encrypt(plaintext, key);
    const b = encrypt(plaintext, key);

    expect(a).not.toBe(b);
    expect(decrypt(a, key)).toBe(plaintext);
    expect(decrypt(b, key)).toBe(plaintext);
  });

  it("fails to decrypt with a wrong key", () => {
    const plaintext = "only-for-the-right-key";
    const encrypted = encrypt(plaintext, key);
    const wrongKey = generateEncryptionKey();

    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });

  it("generateEncryptionKey returns a 64-char hex string", () => {
    const k = generateEncryptionKey();

    expect(k).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(k)).toBe(true);
  });
});
