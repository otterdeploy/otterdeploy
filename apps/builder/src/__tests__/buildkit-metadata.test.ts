import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { cleanupMetadataFile, readImageDigest, tmpMetadataFile } from "../buildkit-metadata";

const allocated: string[] = [];

afterEach(async () => {
  while (allocated.length) {
    const f = allocated.pop();
    if (f) await rm(dirname(f), { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("tmpMetadataFile", () => {
  test("allocates a fresh path each call", async () => {
    const a = await tmpMetadataFile();
    const b = await tmpMetadataFile();
    allocated.push(a, b);
    expect(a).not.toBe(b);
    expect(a.endsWith("/metadata.json")).toBe(true);
  });
});

describe("readImageDigest", () => {
  test("reads containerimage.digest out of a real buildx --metadata-file shape", async () => {
    const f = await tmpMetadataFile();
    allocated.push(f);
    await mkdir(dirname(f), { recursive: true });
    await writeFile(
      f,
      JSON.stringify({
        "containerimage.digest": "sha256:abc123",
        "image.name": "ghcr.io/acme/web:sha,ghcr.io/acme/web:latest",
      }),
    );
    expect(await readImageDigest(f)).toBe("sha256:abc123");
  });

  test("returns null when the file was never written (build failed before push)", async () => {
    expect(await readImageDigest("/tmp/does-not-exist-otter/metadata.json")).toBeNull();
  });

  test("returns null on malformed JSON — never throws", async () => {
    const f = await tmpMetadataFile();
    allocated.push(f);
    await mkdir(dirname(f), { recursive: true });
    await writeFile(f, "{not json");
    expect(await readImageDigest(f)).toBeNull();
  });

  test("returns null when the digest key is missing or not a string", async () => {
    const f = await tmpMetadataFile();
    allocated.push(f);
    await mkdir(dirname(f), { recursive: true });
    await writeFile(f, JSON.stringify({ "image.name": "repo:tag" }));
    expect(await readImageDigest(f)).toBeNull();

    const g = await tmpMetadataFile();
    allocated.push(g);
    await mkdir(dirname(g), { recursive: true });
    await writeFile(g, JSON.stringify({ "containerimage.digest": 12345 }));
    expect(await readImageDigest(g)).toBeNull();
  });
});

describe("cleanupMetadataFile", () => {
  test("removes the scratch dir without throwing, even if already gone", async () => {
    const f = await tmpMetadataFile();
    await cleanupMetadataFile(f);
    // Second call on an already-removed path must not throw.
    await cleanupMetadataFile(f);
    expect(await readImageDigest(f)).toBeNull();
  });
});
