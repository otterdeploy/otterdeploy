import type { sshKeySchema } from "@otterdeploy/api/routers/sshKeys/contract";
import type { z } from "zod";

/**
 * Org-scoped SSH keys for the viewed organization. Everything rides the oRPC
 * `sshKeys` router via plain TanStack Query (`orpc.sshKeys.*`): a `list` query
 * the page reads, and `generate` / `import` / `rotate` / `delete` mutations that
 * invalidate it. Unlike API keys this isn't a TanStack DB collection — there are
 * two distinct create verbs (generate vs import) that don't map onto a single
 * `onInsert`, so a query/mutation surface is the clean fit.
 */
export type SshKey = z.infer<typeof sshKeySchema>;
export type SshKeyType = SshKey["type"];

/** Compact "X ago" for created/last-used stamps on the key cards. */
export function timeAgo(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  const ms = Date.now() - d.getTime();
  if (Number.isNaN(ms)) return null;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 365) return `${day}d ago`;
  return `${Math.round(day / 365)}y ago`;
}
