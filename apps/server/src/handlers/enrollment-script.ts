import type { OtterdJoin } from "@otterdeploy/api/otterd/join";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

const completion = (completeUrl: string, credential: string) =>
  `curl -fsS --retry 5 --retry-all-errors -X POST ${shellQuote(completeUrl)} -H ${shellQuote(`Authorization: Bearer ${credential}`)} >/dev/null`;

export function buildNodeEnrollmentScript(input: {
  joinToken: string;
  managerAddr: string;
  completeUrl: string;
  credential: string;
}): string {
  return [
    "#!/bin/sh",
    "set -eu",
    `docker swarm join --token ${shellQuote(input.joinToken)} ${shellQuote(input.managerAddr)}`,
    completion(input.completeUrl, input.credential),
    'printf "%s\\n" "OtterDeploy node enrollment complete."',
  ].join("\n");
}

/**
 * The otterd runtime's enrollment: this release's installer joins the host
 * as a node. It installs only an otterd release signed by the keys it embeds,
 * fetches the control plane's CA and uses it only if it matches the pin, and
 * enrolls with the single-use token.
 */
export function buildOtterdEnrollmentScript(input: {
  join: OtterdJoin;
  completeUrl: string;
  credential: string;
}): string {
  const j = input.join;
  return [
    "#!/bin/sh",
    "set -eu",
    'installer="$(mktemp)"',
    `curl -fsSL --retry 3 -o "$installer" ${shellQuote(j.installerUrl)}`,
    [
      'bash "$installer" node --yes',
      `--control-url ${shellQuote(j.controlUrl)}`,
      `--ca-sha256 ${shellQuote(j.caPin)}`,
      `--cp-key ${shellQuote(j.cpKey)}`,
      `--token ${shellQuote(j.token)}`,
    ].join(" "),
    'rm -f "$installer"',
    completion(input.completeUrl, input.credential),
    'printf "%s\\n" "OtterDeploy node enrollment complete."',
  ].join("\n");
}
