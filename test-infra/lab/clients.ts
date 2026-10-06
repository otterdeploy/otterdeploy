import type { LabEnv } from "./env";

import { LabDns } from "./cloudflare";
import { HcloudClient } from "./hcloud";

export function labClients(env: LabEnv) {
  return {
    hcloud: new HcloudClient(env.HCLOUD_TOKEN),
    dns: new LabDns(env.CF_DNS_TOKEN, env.CF_ZONE_ID, env.LAB_DNS_SUFFIX),
  };
}
