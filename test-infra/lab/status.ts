/** `status`: every live otterlab resource grouped by run, plus lab DNS records. */
import type { LabEnv } from "./env";

import { labClients } from "./clients";
import { LAB_LABEL, RESOURCE_KINDS } from "./hcloud";
import { localRuns } from "./state";
import { nowEpochSeconds } from "./support";

export async function status(env: LabEnv): Promise<number> {
  const { hcloud, dns } = labClients(env);
  const now = nowEpochSeconds();
  const byRun = new Map<string, string[]>();
  let total = 0;
  for (const kind of RESOURCE_KINDS) {
    const listed = await hcloud.list(kind, `${LAB_LABEL}=1`);
    if (listed.isErr()) {
      console.error(`${kind}: ${listed.error.message}`);
      return 1;
    }
    for (const r of listed.value) {
      total += 1;
      const run = r.labels.run ?? "(no run label)";
      const left = Math.round((Number(r.labels.expires) - now) / 60);
      const line = `${kind.padEnd(9)} ${r.name.padEnd(24)} ${left >= 0 ? `expires in ${left} min` : `EXPIRED ${-left} min ago`}`;
      byRun.set(run, [...(byRun.get(run) ?? []), line]);
    }
  }
  console.log(`hetzner: ${total} otterlab resource(s)`);
  for (const [run, lines] of byRun) console.log(`  run ${run}\n    ${lines.join("\n    ")}`);

  const records = await dns.listLab();
  if (records.isErr()) {
    console.error(`dns: ${records.error.message}`);
    return 1;
  }
  console.log(`dns: ${records.value.length} record(s) under *.${env.LAB_DNS_SUFFIX}`);
  for (const r of records.value)
    console.log(`  ${r.type} ${r.name} -> ${r.content} (${r.created_on})`);
  const runs = localRuns();
  console.log(`local run dirs: ${runs.length === 0 ? "none" : runs.join(", ")}`);
  return 0;
}
