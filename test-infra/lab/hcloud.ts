/**
 * Hetzner Cloud API, called directly (no hcloud CLI). Labels are the state:
 * every resource the lab creates carries `otterlab=1,run=<id>,expires=<epoch>`,
 * and teardown, sweeping and cost accounting are label queries.
 */
import { Result } from "better-result";
import * as z from "zod";

import { fetchJson, LabError, type LabResult, pollUntil } from "./support";

const API = "https://api.hetzner.cloud/v1";

export const LAB_LABEL = "otterlab";
export type Labels = Record<string, string>;

export const RESOURCE_KINDS = ["servers", "firewalls", "networks", "ssh_keys"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

const labelled = z.object({
  id: z.number(),
  name: z.string(),
  labels: z.record(z.string(), z.string()),
});
export type LabelledResource = z.infer<typeof labelled>;

export const serverSchema = labelled.extend({
  status: z.string(),
  created: z.string(),
  server_type: z.object({ name: z.string() }),
  location: z.object({ name: z.string() }).optional(),
  datacenter: z.object({ location: z.object({ name: z.string() }) }).optional(),
  public_net: z.object({
    ipv4: z.object({ ip: z.string() }).nullable(),
    ipv6: z.object({ ip: z.string() }).nullable(),
  }),
  private_net: z.array(z.object({ ip: z.string(), network: z.number() })),
});
export type HServer = z.infer<typeof serverSchema>;

const actionSchema = z.object({
  id: z.number(),
  status: z.enum(["running", "success", "error"]),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
const paginationSchema = z.object({
  meta: z.object({ pagination: z.object({ next_page: z.number().nullable() }) }).optional(),
});

const priceSchema = z.object({
  location: z.string(),
  price_hourly: z.object({ net: z.string(), gross: z.string() }),
});
const pricingSchema = z.object({
  currency: z.string(),
  server_types: z.array(z.object({ name: z.string(), prices: z.array(priceSchema) })),
  primary_ips: z.array(z.object({ type: z.string(), prices: z.array(priceSchema) })),
});
export type Pricing = z.infer<typeof pricingSchema>;

export interface FirewallRule {
  direction: "in";
  protocol: "tcp" | "udp" | "icmp" | "esp";
  port?: string;
  source_ips: string[];
  description: string;
}

export class HcloudClient {
  constructor(private readonly token: string) {}

  private call<S extends z.ZodType>(
    where: string,
    path: string,
    schema: S,
    method = "GET",
    body?: unknown,
  ) {
    return fetchJson(`hcloud ${where}`, `${API}${path}`, schema, {
      method,
      body,
      headers: { Authorization: `Bearer ${this.token}` },
    });
  }

  /** Every resource of `kind` matching `selector`, across pages. */
  async list(kind: ResourceKind, selector: string): Promise<LabResult<LabelledResource[]>> {
    const schema = z.looseObject(paginationSchema.shape);
    const out: LabelledResource[] = [];
    for (let page: number | null = 1; page !== null; ) {
      const query: string = `?label_selector=${encodeURIComponent(selector)}&per_page=50&page=${page}`;
      const result: LabResult<z.infer<typeof schema>> = await this.call(
        `list ${kind}`,
        `/${kind}${query}`,
        schema,
      );
      if (result.isErr()) return Result.err(result.error);
      const items = z.array(labelled).safeParse(result.value[kind]);
      if (!items.success) {
        return Result.err(new LabError(`hcloud list ${kind}`, items.error.message));
      }
      out.push(...items.data);
      page = result.value.meta?.pagination.next_page ?? null;
    }
    return Result.ok(out);
  }

  async listServers(selector: string): Promise<LabResult<HServer[]>> {
    const schema = z.object({ servers: z.array(serverSchema) });
    const result = await this.call(
      "list servers",
      `/servers?label_selector=${encodeURIComponent(selector)}&per_page=50`,
      schema,
    );
    return result.map((value) => value.servers);
  }

  pricing(): Promise<LabResult<Pricing>> {
    const schema = z.object({ pricing: pricingSchema });
    return this.call("pricing", "/pricing", schema).then((r) => r.map((value) => value.pricing));
  }

  async waitAction(actionId: number): Promise<LabResult<void>> {
    const schema = z.object({ action: actionSchema });
    const done = await pollUntil(`hcloud action ${actionId}`, 10 * 60_000, 2_000, async () => {
      const result = await this.call("action", `/actions/${actionId}`, schema);
      if (result.isErr()) return Result.err(result.error);
      const { action } = result.value;
      if (action.status === "error") {
        return Result.err(
          new LabError(`hcloud action ${actionId}`, action.error?.message ?? "failed"),
        );
      }
      return Result.ok(action.status === "success" ? true : undefined);
    });
    return done.map(() => undefined);
  }

  async createSshKey(name: string, publicKey: string, labels: Labels) {
    const schema = z.object({ ssh_key: labelled });
    const body = { name, public_key: publicKey, labels };
    return (await this.call("create ssh key", "/ssh_keys", schema, "POST", body)).map(
      (v) => v.ssh_key,
    );
  }

  async createNetwork(
    name: string,
    topo: { ipRange: string; subnet: string; zone: string },
    labels: Labels,
  ) {
    const schema = z.object({ network: labelled });
    const body = {
      name,
      ip_range: topo.ipRange,
      subnets: [{ type: "cloud", network_zone: topo.zone, ip_range: topo.subnet }],
      labels,
    };
    return (await this.call("create network", "/networks", schema, "POST", body)).map(
      (v) => v.network,
    );
  }

  async createFirewall(name: string, rules: FirewallRule[], labels: Labels) {
    const schema = z.object({ firewall: labelled });
    const body = { name, rules, labels };
    return (await this.call("create firewall", "/firewalls", schema, "POST", body)).map(
      (v) => v.firewall,
    );
  }

  async setFirewallRules(firewallId: number, rules: FirewallRule[]): Promise<LabResult<void>> {
    const schema = z.object({ actions: z.array(actionSchema) });
    const result = await this.call(
      "set firewall rules",
      `/firewalls/${firewallId}/actions/set_rules`,
      schema,
      "POST",
      { rules },
    );
    if (result.isErr()) return Result.err(result.error);
    for (const action of result.value.actions) {
      const waited = await this.waitAction(action.id);
      if (waited.isErr()) return waited;
    }
    return Result.ok(undefined);
  }

  async createServer(spec: {
    name: string;
    serverType: string;
    location: string;
    image: string;
    sshKeyId: number;
    firewallId: number;
    labels: Labels;
  }): Promise<LabResult<{ server: HServer; actionId: number }>> {
    const schema = z.object({ server: serverSchema, action: actionSchema });
    const body = {
      name: spec.name,
      server_type: spec.serverType,
      location: spec.location,
      image: spec.image,
      ssh_keys: [spec.sshKeyId],
      firewalls: [{ firewall: spec.firewallId }],
      labels: spec.labels,
      start_after_create: true,
      public_net: { enable_ipv4: true, enable_ipv6: true },
    };
    const result = await this.call(`create server ${spec.name}`, "/servers", schema, "POST", body);
    return result.map((value) => ({ server: value.server, actionId: value.action.id }));
  }

  async attachToNetwork(serverId: number, networkId: number, ip: string): Promise<LabResult<void>> {
    const schema = z.object({ action: actionSchema });
    const path = `/servers/${serverId}/actions/attach_to_network`;
    const result = await this.call("attach to network", path, schema, "POST", {
      network: networkId,
      ip,
    });
    if (result.isErr()) return Result.err(result.error);
    return this.waitAction(result.value.action.id);
  }

  async getServer(serverId: number): Promise<LabResult<HServer>> {
    const schema = z.object({ server: serverSchema });
    return (await this.call("get server", `/servers/${serverId}`, schema)).map((v) => v.server);
  }

  /** Delete one resource. Servers return an action we wait on, so firewalls
   *  and networks are free (not "in use") by the time we reach them. */
  async remove(kind: ResourceKind, id: number): Promise<LabResult<void>> {
    const schema = z.object({ action: actionSchema.optional() });
    const result = await this.call(`delete ${kind}/${id}`, `/${kind}/${id}`, schema, "DELETE");
    if (result.isErr()) {
      // Already gone is the outcome we wanted.
      if (result.error.message.includes("HTTP 404")) return Result.ok(undefined);
      return Result.err(result.error);
    }
    const action = result.value.action;
    return action ? this.waitAction(action.id) : Result.ok(undefined);
  }
}
