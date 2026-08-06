import type { RouteHashPart } from "@otterdeploy/shared/api-cache";
import type { OrganizationId } from "@otterdeploy/shared/id";
import type * as z from "zod";

import { os as orpc } from "@orpc/server";
import { createApiCacheIdentity } from "@otterdeploy/shared/api-cache";

import type { Context } from "../context";

import { invalidateApiCache, readApiCache, writeApiCache } from "./api-cache";

type OrgContext = Context & { activeOrganizationId: OrganizationId };

interface CacheScopeArgs<TInput> {
  context: OrgContext;
  input: TInput;
}

export interface CacheTarget {
  endpoint: string;
  version?: number;
  scope: readonly RouteHashPart[];
}

interface CacheApiResponseOptions<TInput, TOutput> {
  endpoint: string;
  version?: number;
  ttlSeconds: number;
  dependencyTables: readonly string[];
  outputSchema: z.ZodType<TOutput>;
  /** Return null to bypass caching, for example when authorization fails. */
  scope: (args: CacheScopeArgs<TInput>) => Promise<readonly RouteHashPart[] | null>;
}

/**
 * oRPC read-through response caching. The route owns scope selection; the
 * middleware owns Redis lookup, `next()`, validated storage, and cache hits.
 */
export function cacheApiResponse<TInput, TOutput>(
  options: CacheApiResponseOptions<TInput, TOutput>,
) {
  return orpc
    .$context<OrgContext>()
    .middleware(async ({ context, next }, input: TInput, output) => {
      const scope = await options.scope({ context, input });
      if (!scope) return next();

      const identity = await createApiCacheIdentity({
        endpoint: options.endpoint,
        version: options.version,
        scope,
      });
      const cached = await readApiCache(identity, options.outputSchema);
      if (cached !== undefined) return output(cached);

      const result = await next();
      await writeApiCache(identity, result.output, {
        ttlSeconds: options.ttlSeconds,
        dependencyTables: options.dependencyTables,
      });
      return result;
    });
}

interface InvalidateApiResponsesOptions<TInput> {
  /** Resolve before `next()` so delete handlers cannot erase key material. */
  targets: (args: CacheScopeArgs<TInput>) => Promise<readonly CacheTarget[]>;
}

/** Bust affected endpoint identities only after a mutation succeeds. */
export function invalidateApiResponses<TInput>(options: InvalidateApiResponsesOptions<TInput>) {
  return orpc.$context<OrgContext>().middleware(async ({ context, next }, input: TInput) => {
    const targets = await options.targets({ context, input });
    const result = await next();

    await Promise.all(
      targets.map(async (target) => {
        const identity = await createApiCacheIdentity(target);
        await invalidateApiCache(identity);
      }),
    );
    return result;
  });
}
