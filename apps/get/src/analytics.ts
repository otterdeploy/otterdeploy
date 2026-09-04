import { hmacSha256Hex } from "@otterdeploy/shared/crypto";

const VISITOR_ID_DOMAIN = "get.otterdeploy.com:visitor:v1:";
const VISITOR_ID_HEX_LENGTH = 24;

/**
 * A keyed, truncated identifier used only to deduplicate manifest polls.
 * Keeping the key outside the dataset prevents an offline scan of the IPv4
 * address space from recovering addresses from exported Analytics Engine data.
 */
export async function visitorIdForIp(ip: string, secret: string): Promise<string> {
  if (!ip) throw new TypeError("visitor IP is required");
  if (!secret) throw new TypeError("analytics hash key is required");

  const digest = await hmacSha256Hex(secret, `${VISITOR_ID_DOMAIN}${ip}`);
  return digest.slice(0, VISITOR_ID_HEX_LENGTH);
}

export interface InstallEdgeDataPoint {
  blobs: string[];
  doubles: number[];
  indexes: string[];
}

/** Build the deliberately small Analytics Engine payload, or skip requests
 * whose edge-provided client address is unavailable. User-Agent is excluded. */
export async function installEdgeDataPoint(
  request: Request,
  file: string,
  version: string,
  secret: string,
): Promise<InstallEdgeDataPoint | null> {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return null;

  return {
    blobs: [file, version, request.headers.get("CF-IPCountry") ?? ""],
    doubles: [1],
    indexes: [await visitorIdForIp(ip, secret)],
  };
}
