import { describe, expect, it } from "vite-plus/test";

import {
  buildKeyringFrom,
  currentKeyId,
  decryptForDomain,
  decryptSecret,
  encryptForDomain,
  encryptSecret,
  envelopeKeyId,
  MIN_KEY_MATERIAL_BYTES,
  resolveCurrentKeyId,
  rotateForDomain,
  SECRET_DOMAINS,
} from "../crypto";

describe("encryptSecret/decryptSecret (v1, legacy)", () => {
  it("round-trips arbitrary strings", async () => {
    const inputs = ["", "hello", "ghp_abcdef0123456789", "🦦 unicode + emoji", "x".repeat(4096)];
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
    // valid tag through luck: too flaky for CI.
    const [v, n, last] = ct.split(".");
    if (v === undefined || n === undefined || last === undefined) {
      throw new Error("expected a 3-segment v1 envelope");
    }
    const mid = Math.floor(last.length / 2);
    const tampered = `${v}.${n}.${last.slice(0, mid)}AAAA${last.slice(mid + 4)}`;
    await expect(decryptSecret(tampered)).rejects.toThrow();
  });

  it("rejects malformed input", async () => {
    await expect(decryptSecret("not-a-blob")).rejects.toThrow(/malformed/);
    await expect(decryptSecret("v2.x.y")).rejects.toThrow(/version/);
  });
});

describe("encryptForDomain/decryptForDomain (v2, domain-separated)", () => {
  it("round-trips per domain and stamps the envelope with format/domain/keyId", async () => {
    for (const domain of SECRET_DOMAINS) {
      const ct = await encryptForDomain(`secret-for-${domain}`, domain);
      expect(ct.startsWith(`v2:${domain}:${currentKeyId()}:`)).toBe(true);
      const round = await decryptForDomain(ct, domain);
      expect(round).toBe(`secret-for-${domain}`);
    }
  });

  it("produces different ciphertext for the same plaintext (random nonce)", async () => {
    const a = await encryptForDomain("same", "ssh-keys");
    const b = await encryptForDomain("same", "ssh-keys");
    expect(a).not.toBe(b);
    expect(await decryptForDomain(a, "ssh-keys")).toBe("same");
    expect(await decryptForDomain(b, "ssh-keys")).toBe("same");
  });

  it("does NOT decrypt cross-domain. Wrong expected domain throws", async () => {
    const ct = await encryptForDomain("registry-password", "registry-creds");
    await expect(decryptForDomain(ct, "ssh-keys")).rejects.toThrow(/domain mismatch/);
    await expect(decryptForDomain(ct, "certs")).rejects.toThrow(/domain mismatch/);
    // The correct domain still works.
    expect(await decryptForDomain(ct, "registry-creds")).toBe("registry-password");
  });

  it("does NOT decrypt cross-domain even with a forged envelope domain label", async () => {
    // Encrypt for one domain, then hand-forge the envelope to *claim* it's
    // another domain's ciphertext. An honest mismatch is caught by the
    // domain check alone; this proves the underlying KEY is also different.
    // The forged envelope's declared domain now matches what
    // `decryptForDomain` expects, so it proceeds to decrypt, and must fail
    // the AES-GCM tag rather than silently return garbage as "success".
    const ct = await encryptForDomain("ssh-private-key-material", "ssh-keys");
    const [, , keyId, nonce, cipher] = ct.split(":");
    const forged = ["v2", "registry-creds", keyId, nonce, cipher].join(":");
    await expect(decryptForDomain(forged, "registry-creds")).rejects.toThrow();
  });

  it("rejects malformed v2 input", async () => {
    await expect(decryptForDomain("v2:only:three", "ssh-keys")).rejects.toThrow(/malformed/);
    await expect(decryptForDomain("garbage", "ssh-keys")).rejects.toThrow(/malformed/);
  });

  it("rejects tampered v2 ciphertext", async () => {
    const ct = await encryptForDomain("secret", "certs");
    const parts = ct.split(":");
    const last = parts[4];
    if (last === undefined) throw new Error("expected a 5-segment v2 envelope");
    const mid = Math.floor(last.length / 2);
    parts[4] = `${last.slice(0, mid)}AAAA${last.slice(mid + 4)}`;
    await expect(decryptForDomain(parts.join(":"), "certs")).rejects.toThrow();
  });
});

describe("v1 -> v2 backward compatibility", () => {
  it("decryptForDomain transparently accepts legacy v1 ciphertext under ANY domain", async () => {
    const legacy = await encryptSecret("pre-existing-secret");
    for (const domain of SECRET_DOMAINS) {
      expect(await decryptForDomain(legacy, domain)).toBe("pre-existing-secret");
    }
  });

  it('envelopeKeyId reports "1" for legacy v1 blobs', async () => {
    const legacy = await encryptSecret("x");
    expect(envelopeKeyId(legacy)).toBe("1");
  });
});

describe("rotation", () => {
  it("rotateForDomain upgrades a legacy v1 blob to a current-key v2 envelope, preserving plaintext", async () => {
    const legacy = await encryptSecret("rotate-me");
    const { value, rotated } = await rotateForDomain(legacy, "registry-creds");
    expect(rotated).toBe(true);
    expect(value.startsWith(`v2:registry-creds:${currentKeyId()}:`)).toBe(true);
    expect(await decryptForDomain(value, "registry-creds")).toBe("rotate-me");
  });

  it("rotateForDomain is a no-op when already on the current key id", async () => {
    const ct = await encryptForDomain("already-current", "git-secrets");
    const { value, rotated } = await rotateForDomain(ct, "git-secrets");
    expect(rotated).toBe(false);
    expect(value).toBe(ct);
  });

  it("a keyring that retains an old id's secret keeps deriving that id's key regardless of which id is current", () => {
    // We can't flip the live module's CURRENT_KEY_ID mid-test (it's resolved
    // once at import), so this proves the equivalent guarantee directly: old
    // ciphertext under id "1" must keep decrypting after the keyring gains a
    // new "current" id "2", nothing about id "1"'s material changes.
    const keyring = buildKeyringFrom({
      BETTER_AUTH_SECRET: "a".repeat(32),
      DATA_ENCRYPTION_KEYS: `1:${"a".repeat(32)},2:${"b".repeat(32)}`,
    });
    expect(resolveCurrentKeyId(keyring, "2")).toBe("2");
    expect(resolveCurrentKeyId(keyring, undefined)).toBe("1");
    expect(keyring.get("1")).toBe("a".repeat(32));
    expect(keyring.get("2")).toBe("b".repeat(32));
  });
});

describe("keyring / boot-time validation (fails closed)", () => {
  it("falls back to BETTER_AUTH_SECRET when no keyring is configured", () => {
    const keyring = buildKeyringFrom({ BETTER_AUTH_SECRET: "s".repeat(32) });
    expect(keyring.get("1")).toBe("s".repeat(32));
  });

  it("throws when BETTER_AUTH_SECRET is missing and no keyring is set", () => {
    expect(() => buildKeyringFrom({})).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("throws when BETTER_AUTH_SECRET is shorter than the minimum", () => {
    expect(() => buildKeyringFrom({ BETTER_AUTH_SECRET: "short" })).toThrow(
      new RegExp(`${MIN_KEY_MATERIAL_BYTES}`),
    );
  });

  it("throws when a DATA_ENCRYPTION_KEYS entry's secret is too short", () => {
    expect(() =>
      buildKeyringFrom({
        BETTER_AUTH_SECRET: "s".repeat(32),
        DATA_ENCRYPTION_KEYS: "1:tooshort",
      }),
    ).toThrow(/shorter than/);
  });

  it("throws on a malformed DATA_ENCRYPTION_KEYS entry", () => {
    expect(() =>
      buildKeyringFrom({
        BETTER_AUTH_SECRET: "s".repeat(32),
        DATA_ENCRYPTION_KEYS: "not-a-valid-entry",
      }),
    ).toThrow(/malformed/);
  });

  it("throws on a duplicate key id", () => {
    expect(() =>
      buildKeyringFrom({
        BETTER_AUTH_SECRET: "s".repeat(32),
        DATA_ENCRYPTION_KEYS: `1:${"a".repeat(32)},1:${"b".repeat(32)}`,
      }),
    ).toThrow(/duplicate/);
  });

  it("resolveCurrentKeyId throws when DATA_ENCRYPTION_KEY_ID points at an unknown id", () => {
    const keyring = buildKeyringFrom({ BETTER_AUTH_SECRET: "s".repeat(32) });
    expect(() => resolveCurrentKeyId(keyring, "9")).toThrow(/no matching entry/);
  });
});
