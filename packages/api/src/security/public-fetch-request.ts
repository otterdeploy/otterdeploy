import type { LookupAddress } from "node:dns";
import type { IncomingHttpHeaders } from "node:http";
import type { LookupFunction } from "node:net";

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { UnsafeOutboundUrlError } from "./public-fetch-error";

export interface PublicFetchResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export type PublicRequest = (
  url: URL,
  address: LookupAddress,
  timeoutMs: number,
  maxBytes: number,
) => Promise<PublicFetchResponse>;

function fixedLookup(address: LookupAddress): LookupFunction {
  return ((_hostname, options, callback) => {
    if (typeof options === "object" && options.all) {
      Reflect.apply(callback, undefined, [null, [address]]);
      return;
    }
    Reflect.apply(callback, undefined, [null, address.address, address.family]);
  }) as LookupFunction;
}

export const requestPinnedPublicAddress: PublicRequest = (
  url,
  address,
  timeoutMs,
  maxBytes,
) =>
  new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(
      url,
      {
        agent: false,
        headers: {
          Accept: "text/plain, application/octet-stream;q=0.9",
          "Accept-Encoding": "identity",
          "User-Agent": "OtterDeploy-Blocklist/1",
        },
        lookup: fixedLookup(address),
      },
      (res) => {
        const declared = Number(res.headers["content-length"] ?? 0);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.destroy();
          reject(new UnsafeOutboundUrlError(`Response exceeds ${maxBytes} bytes.`));
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            res.destroy(new UnsafeOutboundUrlError(`Response exceeds ${maxBytes} bytes.`));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
        res.on("error", reject);
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new UnsafeOutboundUrlError("Outbound request timed out."));
    });
    req.on("error", reject);
    req.end();
  });
