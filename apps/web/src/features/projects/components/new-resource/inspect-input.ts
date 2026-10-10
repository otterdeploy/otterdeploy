/**
 * Input for `git.inspectRepo` / `git.inspectEnv`: the bound repo, a folder,
 * and the branch the form will build. Detection (builder, Dockerfile, port,
 * framework, `.env.example` keys) has to describe that branch's tree, not the
 * repo's default branch's. A blank branch leaves `ref` off, which the server
 * reads as "the repo's default branch". Every call site builds its input here
 * so equal (repo, path, branch) triples share one react-query key.
 */
export function inspectInput(
  gitRepoId: string,
  path: string,
  branch: string,
): { gitRepoId: string; path: string; ref?: string } {
  const ref = branch.trim();
  return ref ? { gitRepoId, path, ref } : { gitRepoId, path };
}
