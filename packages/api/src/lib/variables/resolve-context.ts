/**
 * The resolver's per-call state and its detailed result, split out of
 * resolver.ts (line cap). Types only, so importing it adds no runtime edge to
 * the query-module cycle family resolver.ts sits in.
 */
import type { EnvironmentId, PreviewId, ProjectId } from "@otterdeploy/shared/id";

import type { EnvironmentScopeInput } from "../../routers/project/queries/environment-scope";
import type { VaultResolveState } from "./vault-resolve";

export interface ResolveContext {
  projectId: ProjectId;
  // The persistent environment whose var bags apply: the RESOLVING service's
  // own environment, not the project's default. Drives the env-var
  // overlay and the `${{environment.X}}` bag.
  environmentId: EnvironmentId;
  // The same environment as a resource scope: every name ref resolves inside
  // it, so a staging service's `${{db.HOST}}` is staging's db. Main
  // additionally owns legacy unstamped rows (see inEnvironmentScope).
  scope: EnvironmentScopeInput;
  // Preview scoping for RESOURCE lookups: a preview-scoped row (an opt-in DB
  // branch) wins over the base row; null resolves base rows only. Previews
  // are NOT environments. Their var bags are the base env's, unchanged.
  previewId: PreviewId | null;
  /** The active DFS path: resource id → the name the template addressed it
   *  by. A Map rather than a Set so a cycle can be reported in those names
   *  instead of the ids, which say nothing to the operator reading them. */
  visited: Map<string, string>;
  exportsCache: Map<string, Record<string, string>>;
  // `${{vault.<provider>.<ref>}}` state: provider rows load once per
  // resolve, fetched values live only for this resolve's duration.
  vault: VaultResolveState;
  /** Per exports object (cached by identity), the keys whose value came from
   *  a sealed or secret row. How a reference to one is known to carry a
   *  secret whatever either key is called. */
  secretExports: WeakMap<Record<string, string>, ReadonlySet<string>>;
}

/** A resolved bag plus the keys whose value carries a secret: the row itself
 *  is sealed or secret, or it dereferences one (transitively, vault included).
 *  Read surfaces mask by `secretKeys`; the deploy path only needs `env`. */
export interface ResolvedServiceEnv {
  env: Record<string, string>;
  secretKeys: ReadonlySet<string>;
}
