/**
 * Web URL for a repository a service builds from, so the UI can link out to the
 * source instead of only naming it.
 *
 * `github` is the only provider kind the API exposes today
 * (gitProviderKindSchema), but the switch keeps the assumption visible: an
 * unknown kind returns null and the caller renders no link rather than guessing
 * a host and shipping a dead one.
 */

export function repoWebUrl(kind: string | null | undefined, fullName: string): string | null {
  const repo = fullName.trim().replace(/\.git$/, "");
  // owner/repo, anything else (empty, a bare name, a full URL someone pasted)
  // isn't something we can safely turn into a link.
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  switch (kind) {
    case "github":
      return `https://github.com/${repo}`;
    default:
      return null;
  }
}
