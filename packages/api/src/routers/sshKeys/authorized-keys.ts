/**
 * Edits a server's `~/.ssh/authorized_keys` over SSH, for rotating a key that
 * servers sign in with. Same transport as the node reconciler and firewall
 * remediation (`SshSession`, signing in as the server's `sshUser`), so the
 * file edited is the one that user's logins are checked against.
 *
 * Keys are matched by their base64 blob, not the whole line: an operator may
 * have pasted the public key with a different comment or with options in
 * front, and that line still authorizes the same key.
 *
 * The transport throws; these functions turn that into a `RemoteKeyError`
 * that says whether signing in or the edit failed. The script builders throw
 * only on a malformed key line, which our own ssh-keygen never produces.
 */
import { Result, TaggedError } from "better-result";

import { SshSession } from "../server/ssh-exec";

export interface SshHost {
  host: string;
  port: number;
  user: string;
}

/** The base64 blob of an OpenSSH public-key line (its second field). */
export function publicKeyBlob(publicKeyLine: string): string {
  const blob = publicKeyLine.trim().split(/\s+/)[1] ?? "";
  // Interpolated into a shell script below: refuse anything that isn't plain
  // base64, rather than trusting that it came from our own ssh-keygen.
  if (!/^[A-Za-z0-9+/]+={0,3}$/.test(blob)) {
    throw new Error("not an OpenSSH public key line");
  }
  return blob;
}

const AWK_HAS = `awk -v k="$1" '{ for (i = 1; i <= NF; i++) if ($i == k) f = 1 } END { exit f ? 0 : 1 }' "$AK"`;

/**
 * Append `publicKeyLine` unless its blob is already there. Creates `~/.ssh`
 * and the file (mode 700/600) when missing; never touches an existing file's
 * mode or owner.
 */
export function appendKeyScript(publicKeyLine: string): string {
  const blob = publicKeyBlob(publicKeyLine);
  const line = Buffer.from(publicKeyLine.trim(), "utf8").toString("base64");
  return `set -eu
AK="$HOME/.ssh/authorized_keys"
has() { ${AWK_HAS}; }
[ -d "$HOME/.ssh" ] || (umask 077 && mkdir -p "$HOME/.ssh")
[ -e "$AK" ] || (umask 077 && : > "$AK")
if has '${blob}'; then exit 0; fi
# A file that doesn't end in a newline would glue our line onto its last one.
if [ -s "$AK" ] && [ -n "$(tail -c 1 "$AK")" ]; then printf '\\n' >> "$AK"; fi
echo '${line}' | base64 -d >> "$AK"
printf '\\n' >> "$AK"
has '${blob}'
`;
}

/**
 * Remove every line carrying `removeLine`'s blob. Refuses (exit 3) unless
 * `keepLine`'s blob is in the file: this edit must never leave a server with
 * neither key, which would cut the control plane off from it. The rewrite goes
 * through a temp file in the same directory and is moved into place, so an
 * interrupted run leaves the old file, never a truncated one.
 */
export function removeKeyScript(removeLine: string, keepLine: string): string {
  const remove = publicKeyBlob(removeLine);
  const keep = publicKeyBlob(keepLine);
  return `set -eu
AK="$HOME/.ssh/authorized_keys"
has() { ${AWK_HAS}; }
[ -f "$AK" ] || exit 0
has '${keep}' || { echo "the key otterdeploy signs in with is missing from $AK; not editing it" >&2; exit 3; }
has '${remove}' || exit 0
TMP=$(mktemp "$HOME/.ssh/.authorized_keys.XXXXXX")
awk -v k='${remove}' '{ for (i = 1; i <= NF; i++) if ($i == k) next } { print }' "$AK" > "$TMP"
if [ -L "$AK" ]; then cat "$TMP" > "$AK" && rm -f "$TMP"; else chmod 600 "$TMP" && mv -f "$TMP" "$AK"; fi
`;
}

/** A remote edit that didn't happen: `connect` means signing in failed (host
 *  unreachable, or the key isn't accepted); `run` means it signed in and the
 *  edit itself failed. */
export class RemoteKeyError extends TaggedError("RemoteKeyError")<{
  message: string;
  stage: "connect" | "run";
}>() {}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

async function runOnHost(
  host: SshHost,
  privateKey: string,
  script: string,
): Promise<Result<void, RemoteKeyError>> {
  const session = await Result.tryPromise({
    try: () => SshSession.connect({ ...host, privateKey }),
    catch: (cause) => new RemoteKeyError({ stage: "connect", message: messageOf(cause) }),
  });
  if (Result.isError(session)) return Result.err(session.error);
  try {
    const run = await Result.tryPromise({
      try: () => session.value.runScript(script),
      catch: (cause) => new RemoteKeyError({ stage: "run", message: messageOf(cause) }),
    });
    if (Result.isError(run)) return Result.err(run.error);
    if (run.value.exitCode !== 0) {
      const tail = run.value.output.trim().split("\n").slice(-2).join(" ").trim();
      return Result.err(
        new RemoteKeyError({
          stage: "run",
          message: tail || `authorized_keys edit exited with code ${run.value.exitCode}`,
        }),
      );
    }
    return Result.ok(undefined);
  } finally {
    session.value.dispose();
  }
}

/** Sign in with `privateKey` and append `publicKeyLine` to authorized_keys. */
export function addAuthorizedKey(
  host: SshHost,
  privateKey: string,
  publicKeyLine: string,
): Promise<Result<void, RemoteKeyError>> {
  return runOnHost(host, privateKey, appendKeyScript(publicKeyLine));
}

/** Sign in with `privateKey`, remove `removeLine`, keeping `keepLine`. */
export function removeAuthorizedKey(
  host: SshHost,
  privateKey: string,
  removeLine: string,
  keepLine: string,
): Promise<Result<void, RemoteKeyError>> {
  return runOnHost(host, privateKey, removeKeyScript(removeLine, keepLine));
}

/** Prove `privateKey` signs in and can run a command. */
export function checkSignIn(
  host: SshHost,
  privateKey: string,
): Promise<Result<void, RemoteKeyError>> {
  return runOnHost(host, privateKey, "true");
}
