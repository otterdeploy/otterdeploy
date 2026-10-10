/**
 * The installation-token edge of repo inspection (see inspect.ts): the two
 * ways minting a token THROWS, turned into typed results.
 */
import { Result, TaggedError } from "better-result";

import { GithubAppNotConfiguredError, GithubInstallationInvalidError } from "../../git/github-app";
import { InspectRepoUpstreamError } from "./inspect-github";

/** The repo is bound through a GitHub App this install has no credentials
 *  for, so no installation token can be minted to read it. */
export class InspectRepoNotConfiguredError extends TaggedError("InspectRepoNotConfiguredError")<{
  message: string;
}>() {
  constructor(message: string) {
    super({ message });
  }
}

/**
 * Run an inspection whose GitHub calls mint an installation token. Minting
 * THROWS for an App with no credentials or an installation GitHub no longer
 * knows; both escaped the inspect entry points as an untyped 500.
 * Here they become the typed errors the router maps; anything
 * else still propagates.
 */
export async function withInstallationToken<T, E>(
  run: () => Promise<Result<T, E>>,
): Promise<Result<T, E | InspectRepoNotConfiguredError | InspectRepoUpstreamError>> {
  const settled = await Result.tryPromise({ try: run, catch: (cause) => cause });
  if (settled.isOk()) return settled.value;
  const cause = settled.error;
  if (GithubAppNotConfiguredError.is(cause)) {
    return Result.err(new InspectRepoNotConfiguredError(cause.message));
  }
  if (GithubInstallationInvalidError.is(cause)) {
    return Result.err(new InspectRepoUpstreamError(404, cause.message));
  }
  throw cause;
}
