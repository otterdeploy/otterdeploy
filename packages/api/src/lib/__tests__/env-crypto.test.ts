/**
 * od-3pp7: encrypt-at-rest helpers for env var values.
 *
 * The load-bearing property is the passthrough decision: `decryptEnvValue`
 * must decrypt exactly the rows `encryptEnvValue` wrote (and sealed rows'
 * envelopes), pass every legacy plaintext row through byte-identical —
 * including hostile lookalikes that merely start with "v2:" — and stay
 * mutually consistent with the backfill script's isEncrypted test.
 */
import { describe, expect, it } from "vite-plus/test";

import { encryptForDomain } from "../crypto";
import {
  decryptEnvValue,
  decryptUnsealedEnvRows,
  encryptEnvValue,
} from "../env-crypto";

describe("encryptEnvValue/decryptEnvValue", () => {
  it("round-trips arbitrary values through the env-vars domain envelope", async () => {
    const inputs = [
      "",
      "postgres://user:pw@host:5432/db",
      "${{db.URL}}/path",
      "🦦",
      "x".repeat(4096),
    ];
    for (const input of inputs) {
      const stored = await encryptEnvValue(input);
      expect(stored.startsWith("v2:env-vars:")).toBe(true);
      if (input.length > 4) expect(stored).not.toContain(input);
      expect(await decryptEnvValue(stored)).toBe(input);
    }
  });

  it("passes legacy plaintext rows through byte-identical", async () => {
    const legacy = [
      "plain-value",
      "postgres://x",
      "v1-not-an-envelope",
      "  spaced  ",
    ];
    for (const value of legacy) {
      expect(await decryptEnvValue(value)).toBe(value);
    }
  });

  it('passes a user value that merely LOOKS like an envelope ("v2:...") through as literal text', async () => {
    // Wrong segment count: not parseable as v2:domain:keyId:nonce:ct.
    expect(await decryptEnvValue("v2:something-user-typed")).toBe(
      "v2:something-user-typed",
    );
    // Parseable shape but a different domain: another domain's ciphertext
    // must never be transparently decrypted through the env read path.
    const foreign = await encryptForDomain("other-secret", "ssh-keys");
    expect(await decryptEnvValue(foreign)).toBe(foreign);
  });

  it("throws loudly on a well-formed env-vars envelope that fails to decrypt (keyring problem, never passthrough)", async () => {
    const stored = await encryptEnvValue("secret");
    // Corrupt the ciphertext segment so the GCM tag cannot verify.
    const parts = stored.split(":");
    const ct = parts[4] ?? "";
    parts[4] =
      ct.slice(0, -8) + (ct.endsWith("AAAA") ? "BBBB" : "AAAA") + ct.slice(-4);
    await expect(decryptEnvValue(parts.join(":"))).rejects.toThrow();
  });
});

describe("decryptUnsealedEnvRows", () => {
  it("decrypts unsealed rows and returns sealed rows ciphertext-and-all", async () => {
    const sealedCiphertext = await encryptEnvValue("sealed-secret");
    const rows = [
      {
        key: "PLAIN",
        value: await encryptEnvValue("plain-secret"),
        sealed: false,
      },
      { key: "LEGACY", value: "pre-backfill-plaintext", sealed: false },
      { key: "SEALED", value: sealedCiphertext, sealed: true },
    ];
    const out = await decryptUnsealedEnvRows(rows);
    const byKey = Object.fromEntries(out.map((r) => [r.key, r.value]));
    expect(byKey.PLAIN).toBe("plain-secret");
    expect(byKey.LEGACY).toBe("pre-backfill-plaintext");
    expect(byKey.SEALED).toBe(sealedCiphertext);
  });
});
