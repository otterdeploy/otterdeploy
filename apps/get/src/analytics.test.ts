import { describe, expect, test } from "bun:test";

import { installEdgeDataPoint, visitorIdForIp } from "./analytics";

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected promise to reject");
}

describe("visitorIdForIp", () => {
  test("is stable for one address and secret", async () => {
    const first = await visitorIdForIp("203.0.113.12", "test-key-one");
    const second = await visitorIdForIp("203.0.113.12", "test-key-one");

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{24}$/);
    expect(first).not.toContain("203");
  });

  test("cannot be correlated after the secret rotates", async () => {
    const before = await visitorIdForIp("203.0.113.12", "test-key-one");
    const after = await visitorIdForIp("203.0.113.12", "test-key-two");

    expect(after).not.toBe(before);
  });

  test("keeps different addresses distinct", async () => {
    const first = await visitorIdForIp("203.0.113.12", "test-key");
    const second = await visitorIdForIp("203.0.113.13", "test-key");

    expect(second).not.toBe(first);
  });

  test("rejects missing privacy inputs", async () => {
    expect(await rejectionMessage(visitorIdForIp("", "test-key"))).toBe("visitor IP is required");
    expect(await rejectionMessage(visitorIdForIp("203.0.113.12", ""))).toBe(
      "analytics hash key is required",
    );
  });
});

describe("installEdgeDataPoint", () => {
  test("stores only file, version, country, and a keyed identifier", async () => {
    const point = await installEdgeDataPoint(
      new Request("https://get.otterdeploy.com/install.sh", {
        headers: {
          "CF-Connecting-IP": "203.0.113.12",
          "CF-IPCountry": "DE",
          "User-Agent": "must not enter the dataset",
        },
      }),
      "install.sh",
      "latest",
      "test-key",
    );

    expect(point?.blobs).toEqual(["install.sh", "latest", "DE"]);
    expect(point?.blobs).not.toContain("must not enter the dataset");
    expect(point?.doubles).toEqual([1]);
    expect(point?.indexes[0]).toMatch(/^[0-9a-f]{24}$/);
  });

  test("does not create a shared identifier when the edge IP is absent", async () => {
    expect(
      await installEdgeDataPoint(
        new Request("https://get.otterdeploy.com/versions.json"),
        "versions.json",
        "",
        "test-key",
      ),
    ).toBeNull();
  });
});
