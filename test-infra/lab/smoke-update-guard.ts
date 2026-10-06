/**
 * Smoke step c3 (only with `--installer`): `install.sh update` on a host that
 * still carries the pre-od-ckrq DOCKER-USER guard replaces it with the
 * published-ports-only rule, exactly once (od-v1cu). The old rule is put back
 * by hand first, in the form v0.21.0 and earlier installed it.
 */
import { Result } from "better-result";

import type { SmokeContext } from "./smoke-context";

import { LabError, type LabResult } from "./support";

const OLD_GUARD =
  'nft insert rule ip filter DOCKER-USER tcp dport != "{ 80, 443, 3000 }" ct state new counter drop comment "otterdeploy-guard"';
const UPLOADED_INSTALLER = "/root/otterdeploy-install.sh";

export async function updateReplacesOldGuard(ctx: SmokeContext): Promise<LabResult<string>> {
  if (!ctx.localInstaller) return Result.ok("skipped (public installer run)");
  const { ssh, evidence, cpNode } = ctx;
  const seeded = await ssh.must(
    cpNode.ipv4,
    [
      "nft -a list chain ip filter DOCKER-USER | awk '/otterdeploy-guard/{print $NF}' | while read -r h; do nft delete rule ip filter DOCKER-USER handle \"$h\"; done",
      OLD_GUARD,
      "nft list chain ip filter DOCKER-USER",
    ].join("\n"),
  );
  if (seeded.isErr()) return Result.err(seeded.error);
  evidence.write("update-guard-before.txt", seeded.value);

  // No TTY on purpose: update ends in report_access too.
  const update = await ssh.exec(
    cpNode.ipv4,
    `cat ${UPLOADED_INSTALLER} | bash -s -- update --yes`,
    20 * 60_000,
  );
  if (update.isErr()) return Result.err(update.error);
  evidence.write(
    "update-guard-installer.log",
    `exit ${update.value.code}\n${update.value.stdout}\n--- stderr ---\n${update.value.stderr}`,
  );
  const after = await ssh.must(cpNode.ipv4, "nft list chain ip filter DOCKER-USER");
  if (after.isErr()) return Result.err(after.error);
  evidence.write("update-guard-after.txt", after.value);

  const guards = after.value.split("\n").filter((l) => l.includes("otterdeploy-guard"));
  const problems = [
    ...(update.value.code === 0 ? [] : [`update exited ${update.value.code}`]),
    ...(guards.length === 1 ? [] : [`${guards.length} otterdeploy-guard rules after update`]),
    ...(guards.every((l) => l.includes("ct status dnat")) ? [] : ["guard still unscoped"]),
  ];
  if (problems.length > 0) return Result.err(new LabError("update guard", problems.join("; ")));
  return Result.ok(`update exited 0; guard now: ${guards[0]?.trim() ?? ""}`);
}
