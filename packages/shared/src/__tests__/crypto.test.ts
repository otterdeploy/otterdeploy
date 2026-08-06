import { describe, expect, test } from "bun:test";

import { base64UrlDecode, base64UrlEncode, randomSecret, sha256Hex } from "../crypto";

describe("sha256Hex", () => {
  test("matches the frozen SHA-256 test vector", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("base64url codec", () => {
  test("round-trips arbitrary bytes", () => {
    for (const len of [0, 1, 2, 3, 12, 16, 31, 32, 255]) {
      const bytes = new Uint8Array(len);
      crypto.getRandomValues(bytes);
      expect(Array.from(base64UrlDecode(base64UrlEncode(bytes)))).toEqual(Array.from(bytes));
    }
  });

  test("covers every byte value, not just the ASCII range", () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect(Array.from(base64UrlDecode(base64UrlEncode(all)))).toEqual(Array.from(all));
  });

  /**
   * The format is on-disk state: every secret already encrypted in the database
   * is framed in it, and the token signers verify against it. Pinning it to
   * Node's `base64url` is how we notice if anyone "cleans up" the codec into
   * something that no longer reads old blobs.
   */
  test("matches Node's base64url — the format is frozen", () => {
    for (const len of [1, 2, 3, 12, 32]) {
      const bytes = new Uint8Array(len);
      crypto.getRandomValues(bytes);
      expect(base64UrlEncode(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
    }
  });

  test("emits the URL-safe alphabet with no padding", () => {
    // 0xfb 0xff would be "+/" and need padding in standard base64.
    const encoded = base64UrlEncode(new Uint8Array([0xfb, 0xff, 0xbf]));
    expect(encoded).toBe("-_-_");
    for (let len = 1; len <= 8; len++) {
      const out = base64UrlEncode(new Uint8Array(len).fill(0xff));
      expect(out).not.toContain("=");
      expect(out).not.toContain("+");
      expect(out).not.toContain("/");
    }
  });

  test("decodes unpadded input at every remainder length", () => {
    // Encoded lengths % 4 of 2 and 3 are the ones needing re-padding; 0 needs none.
    for (const bytes of [[1], [1, 2], [1, 2, 3]]) {
      const encoded = base64UrlEncode(new Uint8Array(bytes));
      expect(Array.from(base64UrlDecode(encoded))).toEqual(bytes);
    }
  });

  test("empty input is a stable empty string", () => {
    expect(base64UrlEncode(new Uint8Array(0))).toBe("");
    expect(base64UrlDecode("")).toHaveLength(0);
  });
});

describe("randomSecret", () => {
  test("is URL-safe and unpadded at the default and custom sizes", () => {
    for (const bytes of [undefined, 8, 18, 24, 32]) {
      const secret = bytes === undefined ? randomSecret() : randomSecret(bytes);
      expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(base64UrlDecode(secret)).toHaveLength(bytes ?? 24);
    }
  });

  test("does not repeat", () => {
    const seen = new Set(Array.from({ length: 100 }, () => randomSecret()));
    expect(seen.size).toBe(100);
  });
});
