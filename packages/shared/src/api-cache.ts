import { sha256Hex } from "./crypto";

/** One ordered value which affects an API route's response. */
export type RouteHashPart = string | number;

export interface RouteHash {
  canonical: string;
  hash: string;
}

export interface ApiCacheIdentity extends RouteHash {
  /** Private Redis key containing the endpoint response. */
  dataKey: string;
  /** Private Redis channel used by the authenticated subscription transport. */
  eventChannel: string;
}

export interface ApiCacheIdentityInput {
  /** Stable procedure name, for example `project.resource.list`. */
  endpoint: string;
  /** Increment when the endpoint's cached representation changes. */
  version?: number;
  /** Ordered, already-authorized values which determine the response. */
  scope: readonly RouteHashPart[];
}

const ENDPOINT_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const CACHE_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Hash a positionally stable route scope. The type is deliberately
 * `readonly (string | number)[]`: `string | number[]` would mean either one
 * string or one numbers-only array, which is not the route-key shape.
 */
export async function getRouteHash(parts: readonly RouteHashPart[]): Promise<RouteHash> {
  const canonical = JSON.stringify(parts);
  return { canonical, hash: await sha256Hex(canonical) };
}

export function apiCacheEventChannel(hash: string): string {
  if (!CACHE_HASH_PATTERN.test(hash)) throw new Error("Invalid API cache hash");
  return `api:cache:events:${hash}`;
}

/** Extract the identity from an endpoint data key; null for unrelated keys. */
export function apiCacheHashFromDataKey(dataKey: string): string | null {
  if (!dataKey.startsWith("api:cache:") || dataKey.startsWith("api:cache:events:")) return null;
  const hash = dataKey.slice(dataKey.lastIndexOf(":") + 1);
  return CACHE_HASH_PATTERN.test(hash) ? hash : null;
}

/** Create one deterministic cache identity from an authorized route scope. */
export async function createApiCacheIdentity(
  input: ApiCacheIdentityInput,
): Promise<ApiCacheIdentity> {
  if (!ENDPOINT_PATTERN.test(input.endpoint)) {
    throw new Error(`Invalid API cache endpoint: ${input.endpoint}`);
  }
  const version = input.version ?? 1;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("API cache version must be a positive safe integer");
  }

  const { canonical, hash } = await getRouteHash([
    "otterdeploy-api-cache",
    input.endpoint,
    version,
    ...input.scope,
  ]);

  return {
    canonical,
    hash,
    dataKey: `api:cache:${input.endpoint}:v${version}:${hash}`,
    eventChannel: apiCacheEventChannel(hash),
  };
}
