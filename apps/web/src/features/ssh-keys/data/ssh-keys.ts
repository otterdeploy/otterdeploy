import type {
  rotateServerResultSchema,
  sshKeySchema,
} from "@otterdeploy/api/routers/sshKeys/contract";
import type { z } from "zod";

import { epochMsOf } from "@/shared/lib/clock";
import { relativeMs } from "@/shared/lib/time";

/**
 * Org-scoped SSH keys for the viewed organization. Everything rides the oRPC
 * `sshKeys` router via plain TanStack Query (`orpc.sshKeys.*`): a `list` query
 * the page reads, and `generate` / `import` / `rotate` / `delete` mutations that
 * invalidate it. Unlike API keys this isn't a TanStack DB collection. There are
 * two distinct create verbs (generate vs import) that don't map onto a single
 * `onInsert`, and rotate reports per-server results a collection update would
 * drop, so a query/mutation surface is the clean fit.
 */
export type SshKey = z.infer<typeof sshKeySchema>;
export type SshKeyType = SshKey["type"];
export type SshKeyUsage = SshKey["usedBy"][number];
export type RotateServerResult = z.infer<typeof rotateServerResultSchema>;

/** Compact "X ago" for created/last-used stamps. `null` for a stamp the key
 *  doesn't have, which the row renders as nothing at all. */
export function timeAgoOrNull(value: Date | null | undefined): string | null {
  if (!value) return null;
  const ms = epochMsOf(value);
  return Number.isNaN(ms) ? null : relativeMs(ms);
}

export function keyTypeLabel(key: Pick<SshKey, "type" | "bits">): string {
  return key.bits ? `${key.type}-${key.bits}` : key.type;
}

export function truncateFingerprint(fp: string): string {
  if (fp.length <= 28) return fp;
  return `${fp.slice(0, 14)}…${fp.slice(-10)}`;
}

/** An OpenSSH public-key line split for a one-line, middle-truncated view:
 *  "ssh-ed25519 AAAAC3NzaC1lZD…fBZC6pwZ comment". */
export function publicKeyParts(line: string): { type: string; blob: string; comment: string } {
  const [type = "", blob = "", ...rest] = line.trim().split(/\s+/);
  const short = blob.length > 24 ? `${blob.slice(0, 14)}…${blob.slice(-8)}` : blob;
  return { type, blob: short, comment: rest.join(" ") };
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "w1", "w1 and w2", "w1, w2 and w3". */
export function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
