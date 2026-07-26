import { describe, expect, it } from "vite-plus/test";

import {
  ArchiveCorruptError,
  formatRecoveryKeyForDisplay,
  generateRecoveryKey,
  isValidRecoveryKey,
  normalizeRecoveryKeyInput,
  RecoveryKeyMismatchError,
  recoveryKeyFingerprint,
  unwrapControlPlaneArchive,
  wrapControlPlaneArchive,
} from "../recovery-key";

describe("generateRecoveryKey", () => {
  it("produces a 64-char hex string", () => {
    const key = generateRecoveryKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(isValidRecoveryKey(key)).toBe(true);
  });

  it("is different every call", () => {
    const a = generateRecoveryKey();
    const b = generateRecoveryKey();
    expect(a).not.toBe(b);
  });
});

describe("isValidRecoveryKey", () => {
  it("rejects malformed input", () => {
    expect(isValidRecoveryKey("")).toBe(false);
    expect(isValidRecoveryKey("not-hex-at-all")).toBe(false);
    expect(isValidRecoveryKey("a".repeat(63))).toBe(false); // too short
    expect(isValidRecoveryKey("a".repeat(65))).toBe(false); // too long
    expect(isValidRecoveryKey(`${"g".repeat(64)}`)).toBe(false); // non-hex char
  });

  it("accepts a generated key", () => {
    expect(isValidRecoveryKey(generateRecoveryKey())).toBe(true);
  });
});

describe("formatRecoveryKeyForDisplay / normalizeRecoveryKeyInput", () => {
  it("round-trips through display formatting", () => {
    const key = generateRecoveryKey();
    const displayed = formatRecoveryKeyForDisplay(key);
    expect(displayed).toMatch(/^([0-9A-F]{4}-){15}[0-9A-F]{4}$/);
    expect(normalizeRecoveryKeyInput(displayed)).toBe(key.toLowerCase());
  });

  it("tolerates operator-pasted whitespace", () => {
    const key = generateRecoveryKey();
    const messy = `  ${formatRecoveryKeyForDisplay(key)}\n`;
    expect(normalizeRecoveryKeyInput(messy)).toBe(key.toLowerCase());
  });
});

describe("recoveryKeyFingerprint", () => {
  it("is stable for the same key", async () => {
    const key = generateRecoveryKey();
    const fp1 = await recoveryKeyFingerprint(key);
    const fp2 = await recoveryKeyFingerprint(key);
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[0-9a-f]{16}$/);
  });

  it("differs across keys (no collisions in a small sample)", async () => {
    const fps = await Promise.all(
      Array.from({ length: 25 }, () => generateRecoveryKey()).map((k) => recoveryKeyFingerprint(k)),
    );
    expect(new Set(fps).size).toBe(fps.length);
  });

  it("never contains the raw key material", async () => {
    const key = generateRecoveryKey();
    const fp = await recoveryKeyFingerprint(key);
    expect(fp).not.toBe(key);
    expect(key).not.toContain(fp);
  });
});

describe("wrapControlPlaneArchive / unwrapControlPlaneArchive", () => {
  it("round-trips arbitrary bytes", async () => {
    const key = generateRecoveryKey();
    const payloads = [
      new Uint8Array(0),
      new TextEncoder().encode("hello control plane"),
      crypto.getRandomValues(new Uint8Array(1024)),
    ];
    for (const payload of payloads) {
      const wrapped = await wrapControlPlaneArchive(payload, key);
      const unwrapped = await unwrapControlPlaneArchive(wrapped, key);
      expect(Buffer.compare(unwrapped, Buffer.from(payload))).toBe(0);
    }
  });

  it("produces different ciphertext for the same plaintext+key (random nonce)", async () => {
    const key = generateRecoveryKey();
    const payload = new TextEncoder().encode("same plaintext every time");
    const a = await wrapControlPlaneArchive(payload, key);
    const b = await wrapControlPlaneArchive(payload, key);
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it("accepts a display-formatted key (dashes/case) at unwrap time", async () => {
    const key = generateRecoveryKey();
    const payload = new TextEncoder().encode("archive contents");
    const wrapped = await wrapControlPlaneArchive(payload, key);
    const unwrapped = await unwrapControlPlaneArchive(wrapped, formatRecoveryKeyForDisplay(key));
    expect(unwrapped.toString()).toBe("archive contents");
  });

  it("rejects the wrong recovery key with a clear mismatch error, not a generic crypto failure", async () => {
    const key = generateRecoveryKey();
    const wrongKey = generateRecoveryKey();
    const payload = new TextEncoder().encode("secret control-plane state");
    const wrapped = await wrapControlPlaneArchive(payload, key);
    await expect(unwrapControlPlaneArchive(wrapped, wrongKey)).rejects.toThrow(
      RecoveryKeyMismatchError,
    );
  });

  it("detects tampering (flipped ciphertext byte) as archive corruption", async () => {
    const key = generateRecoveryKey();
    const payload = new TextEncoder().encode("data that must not be silently corrupted");
    const wrapped = await wrapControlPlaneArchive(payload, key);
    const tampered = Buffer.from(wrapped);
    // Flip a byte well past the fixed header (magic+fingerprint+nonce), inside
    // the ciphertext, so the fingerprint pre-check still passes and the GCM
    // tag is what catches it.
    const lastIndex = tampered.length - 1;
    tampered[lastIndex] = (tampered[lastIndex] ?? 0) ^ 0xff;
    await expect(unwrapControlPlaneArchive(tampered, key)).rejects.toThrow(ArchiveCorruptError);
  });

  it("detects truncation as archive corruption", async () => {
    const key = generateRecoveryKey();
    const payload = new TextEncoder().encode("data");
    const wrapped = await wrapControlPlaneArchive(payload, key);
    const truncated = wrapped.subarray(0, 5);
    await expect(unwrapControlPlaneArchive(truncated, key)).rejects.toThrow(ArchiveCorruptError);
  });

  it("rejects malformed recovery keys up front", async () => {
    const payload = new TextEncoder().encode("data");
    await expect(wrapControlPlaneArchive(payload, "not-a-valid-key")).rejects.toThrow();
    const key = generateRecoveryKey();
    const wrapped = await wrapControlPlaneArchive(payload, key);
    await expect(unwrapControlPlaneArchive(wrapped, "not-a-valid-key")).rejects.toThrow();
  });
});
