import type { sshKeySchema } from "@otterdeploy/api/routers/sshKeys/contract";
import type { z } from "zod";

import { relativeMs } from "@/shared/lib/time";

/**
 * Org-scoped SSH keys for the viewed organization. Everything rides the oRPC
 * `sshKeys` router via plain TanStack Query (`orpc.sshKeys.*`): a `list` query
 * the page reads, and `generate` / `import` / `rotate` / `delete` mutations that
 * invalidate it. Unlike API keys this isn't a TanStack DB collection. There are
 * two distinct create verbs (generate vs import) that don't map onto a single
 * `onInsert`, so a query/mutation surface is the clean fit.
 */
export type SshKey = z.infer<typeof sshKeySchema>;
export type SshKeyType = SshKey["type"];

/** Compact "X ago" for created/last-used stamps on the key cards. `null` for
 *  a stamp the key doesn't have, which the card renders as nothing at all. */
export function timeAgoOrNull(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const ms = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isNaN(ms) ? null : relativeMs(ms);
}
