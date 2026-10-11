import type { Context } from "hono";

/**
 * `GET /install-node.sh`: the short entry point for the dashboard's Add a
 * server command,
 *
 *   curl -fsSL https://<control-plane>/install-node.sh | sudo sh -s -- --token <token>
 *
 * The script is the same for everyone and carries no secret, so fetching it
 * needs no credential. The one-time token arrives as an argument; the script
 * derives the enrollment id from it (`<id>.<secret>`), redeems it at the
 * existing `/api/node-enrollments/:id/redeem` route, and runs what comes back.
 * That is exactly what the old one-line command did inline, so redemption,
 * rate limiting and auditing are unchanged.
 *
 * The control-plane address is resolved from configuration, never from the
 * request's Host: the script sends its bearer token to that address, so a
 * spoofed authority must not be able to redirect it.
 */

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function buildInstallNodeScript(origin: string): string {
  return [
    "#!/bin/sh",
    "# Installs this machine as a server of the otterdeploy control plane below.",
    "# Usage: curl -fsSL <control-plane>/install-node.sh | sudo sh -s -- --token <token>",
    "set -eu",
    `control_plane=${shellQuote(origin)}`,
    'token=""',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    "    --token)",
    '      [ "$#" -ge 2 ] || { echo "install-node.sh: --token needs a value." >&2; exit 2; }',
    '      token="$2"; shift 2 ;;',
    '    --token=*) token="${1#--token=}"; shift ;;',
    '    *) echo "install-node.sh: unknown option $1" >&2; exit 2 ;;',
    "  esac",
    "done",
    'if [ -z "$token" ]; then',
    '  echo "install-node.sh: missing --token. Copy the whole command from Add a server in otterdeploy." >&2',
    "  exit 2",
    "fi",
    // The token is `<enrollment id>.<secret>`; the id names the redeem route.
    'id="${token%%.*}"',
    'case "$id" in',
    '  "" | "$token" | *[!a-z0-9_]*)',
    '    echo "install-node.sh: that is not an otterdeploy install token." >&2',
    "    exit 2 ;;",
    "esac",
    // Fetch the whole installer before running any of it, so a connection
    // that drops mid-download cannot execute half a script.
    'installer="$(curl -fsS -X POST "$control_plane/api/node-enrollments/$id/redeem" -H "Authorization: Bearer $token")"',
    "printf '%s\\n' \"$installer\" | sh",
    "",
  ].join("\n");
}

export function createInstallNodeHandler(resolveOrigin: () => Promise<string>) {
  return async (c: Context): Promise<Response> => {
    const script = buildInstallNodeScript(await resolveOrigin());
    return c.text(script, 200, {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      // The address inside follows configuration; never let a proxy pin it.
      "Cache-Control": "no-store",
    });
  };
}
