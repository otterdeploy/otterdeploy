/**
 * Cloudflare DNS for the lab, fenced to `*.<run>.<LAB_DNS_SUFFIX>`.
 *
 * The zone also holds records the lab must never touch, so every write is
 * checked twice: the name is validated before a create, and a delete first
 * re-reads the record BY ID and refuses unless its name is inside the lab
 * fence. Deletes are always by an id we created and tracked (or, for the
 * sweeper, by an id we just listed and re-verified), never by pattern.
 */
import { Result } from "better-result";
import * as z from "zod";

import { fetchJson, LabError, type LabResult } from "./support";

const API = "https://api.cloudflare.com/client/v4";

const recordSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  content: z.string(),
  comment: z.string().nullable().optional(),
  created_on: z.string(),
});
export type DnsRecord = z.infer<typeof recordSchema>;

const envelope = <S extends z.ZodType>(result: S) =>
  z.object({
    success: z.boolean(),
    result,
    result_info: z.object({ total_pages: z.number() }).optional(),
  });

export class LabDns {
  constructor(
    private readonly token: string,
    private readonly zoneId: string,
    /** e.g. `lab.otterstack.dev` */
    readonly suffix: string,
  ) {}

  private call<S extends z.ZodType>(
    where: string,
    path: string,
    schema: S,
    method = "GET",
    body?: unknown,
  ) {
    return fetchJson(`cloudflare ${where}`, `${API}/zones/${this.zoneId}${path}`, schema, {
      method,
      body,
      headers: { Authorization: `Bearer ${this.token}` },
    });
  }

  /** True only for `<label>.<…>.<suffix>`: strictly below the lab suffix. */
  isLabName(name: string): boolean {
    return name.endsWith(`.${this.suffix}`) && name.length > this.suffix.length + 1;
  }

  /** True only for names strictly below `<run>.<suffix>`. */
  isRunName(name: string, run: string): boolean {
    const runZone = `${run}.${this.suffix}`;
    return name.endsWith(`.${runZone}`) && name.length > runZone.length + 1;
  }

  async createA(
    run: string,
    name: string,
    ip: string,
    comment: string,
  ): Promise<LabResult<DnsRecord>> {
    if (!this.isRunName(name, run)) {
      return Result.err(
        new LabError("cloudflare create", `refusing ${name}: outside *.${run}.${this.suffix}`),
      );
    }
    const body = { type: "A", name, content: ip, ttl: 60, proxied: false, comment };
    const result = await this.call(
      `create ${name}`,
      "/dns_records",
      envelope(recordSchema),
      "POST",
      body,
    );
    return result.map((value) => value.result);
  }

  /** Every record strictly below the lab suffix (other zone records are filtered out twice). */
  async listLab(): Promise<LabResult<DnsRecord[]>> {
    const out: DnsRecord[] = [];
    for (let page = 1, pages = 1; page <= pages; page += 1) {
      const query = `?name.endswith=${encodeURIComponent(`.${this.suffix}`)}&per_page=100&page=${page}`;
      const result = await this.call(
        "list",
        `/dns_records${query}`,
        envelope(z.array(recordSchema)),
      );
      if (result.isErr()) return Result.err(result.error);
      out.push(...result.value.result.filter((record) => this.isLabName(record.name)));
      pages = result.value.result_info?.total_pages ?? 1;
    }
    return Result.ok(out);
  }

  /** Delete a record by id after re-reading it and checking it is inside `fence`. */
  async deleteById(
    id: string,
    fence: (name: string) => boolean,
  ): Promise<LabResult<string | null>> {
    const current = await this.call(`get ${id}`, `/dns_records/${id}`, envelope(recordSchema));
    if (current.isErr()) {
      if (current.error.message.includes("HTTP 404")) return Result.ok(null);
      return Result.err(current.error);
    }
    const name = current.value.result.name;
    if (!fence(name)) {
      return Result.err(
        new LabError(
          "cloudflare delete",
          `refusing to delete ${name} (${id}): outside the lab fence`,
        ),
      );
    }
    const deleted = await this.call(
      `delete ${name}`,
      `/dns_records/${id}`,
      envelope(z.object({ id: z.string() })),
      "DELETE",
    );
    return deleted.map(() => name);
  }
}
