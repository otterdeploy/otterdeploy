import type {
  gitInstallationViewSchema,
  gitProviderViewSchema,
} from "@otterdeploy/api/routers/git/contract";
import type { z } from "zod";

import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { persistence } from "@/shared/db/sqlite-persistence";
import { orpc, queryClient } from "@/shared/server/orpc";

/** One git provider (with its installations) as returned by orpc.git.list. */
export type ProviderView = z.infer<typeof gitProviderViewSchema>;

/** One installation under a provider. */
export type InstallationView = z.infer<typeof gitInstallationViewSchema>;

/**
 * Org-scoped git providers for the active org. Read-only collection: the page
 * just lists providers + their installations. Mutations stay as plain oRPC
 * calls in the components — `disconnect`/`refreshRepos` are installation-scoped
 * (not provider-scoped), and connect is a one-shot bootstrap that redirects off
 * to GitHub, so neither maps onto a collection delete/insert.
 */
const gitProvidersQueryOptions = queryCollectionOptions({
  // Stable id — persistedCollectionOptions keys the SQLite table off it; a
  // random per-load id would never round-trip (see project.ts).
  id: "git-providers",
  ...orpc.git.list.queryOptions({ input: undefined }),
  queryKey: orpc.git.list.queryKey({ input: undefined }),
  queryFn: async () => orpc.git.list.call(),
  queryClient,
  getKey: (item) => item.id,
});

type GitProviderRow = Awaited<ReturnType<typeof orpc.git.list.call>>[number];

// Call `createCollection` inside each branch — the persisted and plain option
// objects are different types (see project.ts for the full type note).
export const gitProvidersCollection = persistence
  ? createCollection(
      persistedCollectionOptions<GitProviderRow, string | number>({
        ...gitProvidersQueryOptions,
        persistence,
        schemaVersion: 1,
      }),
    )
  : createCollection(gitProvidersQueryOptions);
