import { describe, expect, test } from "bun:test";
import { createPrivateKey, sign } from "node:crypto";

import {
  type ReleaseInput,
  buildManifest,
  detachedSigner,
  seedSigner,
  signRelease,
  signingInputOf,
  verifyRelease,
} from "./manifest";

const amd = new Uint8Array([1, 2, 3, 4]);
const arm = new Uint8Array([5, 6, 7]);
const input: ReleaseInput = {
  version: "0.3.0",
  binaries: [
    { arch: "x86_64", bytes: amd },
    { arch: "aarch64", bytes: arm },
  ],
  protocol: { min: 1, max: 1 },
  journalFormat: 1,
  minRollbackVersion: "0.2.0",
  issuedAtUnixMs: 1_900_000_000_000,
};
const seed = new Uint8Array(32).fill(7);
const signer = seedSigner(seed);
const keys = (key: string, notAfterUnixMs?: number) => ({
  serial: 1,
  keys: [{ key, ...(notAfterUnixMs ? { notAfterUnixMs } : {}) }],
});

describe("release manifest", () => {
  test("names each binary by architecture, size and SHA-256", () => {
    const { manifest } = buildManifest(input).unwrap();
    expect(manifest.artifacts).toEqual([
      {
        arch: "x86_64",
        size: 4,
        sha256: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
      },
      { arch: "aarch64", size: 3, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
  });

  test("refuses an unknown or repeated architecture", () => {
    const bad = (binaries: ReleaseInput["binaries"]) => buildManifest({ ...input, binaries });
    expect(bad([{ arch: "arm64", bytes: arm }]).isErr()).toBe(true);
    expect(
      bad([
        { arch: "x86_64", bytes: amd },
        { arch: "x86_64", bytes: arm },
      ]).isErr(),
    ).toBe(true);
    expect(bad([]).isErr()).toBe(true);
  });

  test("a release job's seed and an offline signature give the same verified release", async () => {
    const { payload } = buildManifest(input).unwrap();
    const fromSeed = (await signRelease(payload, signer)).unwrap();
    const offlineKey = createPrivateKey({
      key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
      format: "der",
      type: "pkcs8",
    });
    const signature = new Uint8Array(sign(null, signingInputOf(payload), offlineKey));
    const offline = (
      await signRelease(payload, detachedSigner(signer.publicKey, signature))
    ).unwrap();
    expect(offline).toEqual(fromSeed);
    const manifest = verifyRelease(fromSeed, keys(signer.publicKey), input.issuedAtUnixMs, [
      { arch: "x86_64", bytes: amd },
    ]).unwrap();
    expect(manifest.version).toBe("0.3.0");
  });

  test("never emits a release its key does not verify", async () => {
    const { payload } = buildManifest(input).unwrap();
    const wrong = detachedSigner(signer.publicKey, new Uint8Array(64).fill(1));
    expect((await signRelease(payload, wrong)).isErr()).toBe(true);
  });

  test("a node refuses another key, an expired key, or a binary that differs", async () => {
    const { payload } = buildManifest(input).unwrap();
    const env = (await signRelease(payload, signer)).unwrap();
    const other = seedSigner(new Uint8Array(32).fill(8)).publicKey;
    expect(verifyRelease(env, keys(other), input.issuedAtUnixMs).isErr()).toBe(true);
    expect(
      verifyRelease(
        env,
        keys(signer.publicKey, input.issuedAtUnixMs),
        input.issuedAtUnixMs,
      ).isErr(),
    ).toBe(true);
    const tampered = verifyRelease(env, keys(signer.publicKey), input.issuedAtUnixMs, [
      { arch: "x86_64", bytes: new Uint8Array([1, 2, 3, 5]) },
    ]);
    expect(tampered.isErr() && tampered.error).toBe("the x86_64 binary does not match the release");
  });
});
