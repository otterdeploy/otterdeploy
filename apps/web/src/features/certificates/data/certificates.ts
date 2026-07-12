/**
 * Org-wide certificates page data layer. Everything rides the oRPC
 * `certificates` router via plain TanStack Query:
 *
 *   - `inventory`  — live TLS probes of every enabled public domain (ground
 *     truth; "Recheck" just invalidates this query).
 *   - `listCustom` — uploaded custom certs (metadata only; keys never leave
 *     the server). Serving status is derived by comparing the stored leaf
 *     fingerprint against the live probe — not by trusting our own writes.
 *   - `listCas`    — the trusted-CA inventory.
 */
import { orpc, queryClient } from "@/shared/server/orpc";

export type CertificateInventory = Awaited<ReturnType<typeof orpc.certificates.inventory.call>>;
export type ProbedCertificate = CertificateInventory["certificates"][number];
export type ProbeStatus = ProbedCertificate["status"];

export type CustomCertificate = Awaited<
  ReturnType<typeof orpc.certificates.listCustom.call>
>[number];
export type TrustedCa = Awaited<ReturnType<typeof orpc.certificates.listCas.call>>[number];

/** Live-probe status vocabulary — mirrors the per-project Networking tab so
 *  the two surfaces read identically. */
export const PROBE_STATUS: Record<ProbeStatus, { label: string; dot: string; text: string }> = {
  valid: { label: "Valid", dot: "bg-success", text: "text-success" },
  expiring: { label: "Expiring soon", dot: "bg-amber-500", text: "text-amber-500" },
  expired: { label: "Expired", dot: "bg-destructive", text: "text-destructive" },
  internal: { label: "Self-signed", dot: "bg-sky-500", text: "text-sky-500" },
  error: { label: "Unreachable", dot: "bg-muted-foreground", text: "text-muted-foreground" },
};

/** Real, observed state of a custom cert — derived from install outcome +
 *  the live probe, never asserted optimistically. */
export type CustomCertStatus =
  | { kind: "error"; detail: string | null }
  | { kind: "unrouted" }
  | { kind: "serving"; domains: string[] }
  | { kind: "installed-not-observed" }
  | { kind: "pending" };

export function deriveCustomStatus(
  cert: CustomCertificate,
  inventory: CertificateInventory | undefined,
): CustomCertStatus {
  if (cert.installState === "error") return { kind: "error", detail: cert.installError };
  if (cert.matchingDomains.length === 0) return { kind: "unrouted" };
  const servingDomains =
    inventory?.certificates.reduce<string[]>((acc, p) => {
      if (p.fingerprint !== null && p.fingerprint === cert.fingerprint256) acc.push(p.domain);
      return acc;
    }, []) ?? [];
  if (servingDomains.length > 0) return { kind: "serving", domains: servingDomains };
  if (cert.installState === "installed") return { kind: "installed-not-observed" };
  return { kind: "pending" };
}

export function daysUntil(date: Date | string): number {
  const ms = new Date(date).getTime() - Date.now();
  return Math.floor(ms / 86_400_000);
}

/** "2026-11-04 · in 118d" (warn threshold is the caller's concern). */
export function expiryLabel(date: Date | string): string {
  const d = new Date(date);
  const days = daysUntil(d);
  const iso = d.toLocaleDateString();
  if (days < 0) return `${iso} · expired ${-days}d ago`;
  return `${iso} · in ${days}d`;
}

export function truncateMiddle(value: string, max = 24): string {
  if (value.length <= max) return value;
  const half = Math.floor((max - 1) / 2);
  return `${value.slice(0, half)}…${value.slice(-half)}`;
}

export function invalidateCertificates(): void {
  void queryClient.invalidateQueries({ queryKey: orpc.certificates.inventory.queryKey() });
  void queryClient.invalidateQueries({ queryKey: orpc.certificates.listCustom.queryKey() });
}

/** Compact "X ago" for the uploaded column. */
export function timeAgo(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (!Number.isFinite(sec) || sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 365) return `${day}d ago`;
  return `${Math.round(day / 365)}y ago`;
}
