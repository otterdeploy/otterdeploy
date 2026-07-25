import type { AddressInfo } from "node:net";
import type { RequestListener } from "node:http";

import { createServer } from "node:http";

import { describe, expect, test } from "vite-plus/test";

import { requestPinnedPublicAddress } from "../public-fetch-request";

async function withServer(
  handler: RequestListener,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address() as AddressInfo;
    await run(address.port);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("requestPinnedPublicAddress", () => {
  test("pins the socket address without changing the HTTP Host", async () => {
    await withServer(
      (request, response) => {
        response.end(request.headers.host);
      },
      async (port) => {
        const url = new URL(`http://blocklist.example:${port}/list`);
        const result = await requestPinnedPublicAddress(
          url,
          { address: "127.0.0.1", family: 4 },
          1_000,
          1_024,
        );
        expect(result.body.toString()).toBe(`blocklist.example:${port}`);
      },
    );
  });

  test("rejects declared and streamed bodies above the byte limit", async () => {
    await withServer(
      (request, response) => {
        if (request.url === "/declared") response.setHeader("content-length", "100");
        response.end("x".repeat(100));
      },
      async (port) => {
        const address = { address: "127.0.0.1", family: 4 as const };
        await expect(
          requestPinnedPublicAddress(
            new URL(`http://blocklist.example:${port}/declared`),
            address,
            1_000,
            10,
          ),
        ).rejects.toThrow("exceeds 10 bytes");
        await expect(
          requestPinnedPublicAddress(
            new URL(`http://blocklist.example:${port}/streamed`),
            address,
            1_000,
            10,
          ),
        ).rejects.toThrow("exceeds 10 bytes");
      },
    );
  });

});
