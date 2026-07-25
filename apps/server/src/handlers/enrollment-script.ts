function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

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
    `curl -fsS --retry 5 --retry-all-errors -X POST ${shellQuote(input.completeUrl)} -H ${shellQuote(`Authorization: Bearer ${input.credential}`)} >/dev/null`,
    'printf "%s\\n" "OtterDeploy node enrollment complete."',
  ].join("\n");
}
