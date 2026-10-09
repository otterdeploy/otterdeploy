/**
 * Presentation for a probed edge certificate, shared by the route detail panel
 * and anything else that shows cert state. Extracted so the status vocabulary
 * (colour + label per status) stays identical wherever a certificate appears,
 * one coherent vocabulary, per DESIGN.md.
 */

import type { orpc } from "@/shared/server/orpc";

import { SELF_SIGNED_TONE } from "@/shared/components/domains/self-signed-tone";

export type RouteCertificate = Awaited<
  ReturnType<typeof orpc.project.proxyRoute.certificates.call>
>["certificates"][number];

type CertStatus = RouteCertificate["status"];

export const CERT_STATUS: Record<CertStatus, { label: string; dot: string; text: string }> = {
  valid: { label: "Valid", dot: "bg-success", text: "text-success" },
  expiring: { label: "Expiring soon", dot: "bg-amber-500", text: "text-amber-500" },
  expired: { label: "Expired", dot: "bg-destructive", text: "text-destructive" },
  // The one colour self-signed wears everywhere (self-signed-tone.ts).
  internal: { label: "Self-signed", dot: SELF_SIGNED_TONE.dot, text: SELF_SIGNED_TONE.text },
  error: { label: "Unreachable", dot: "bg-muted-foreground", text: "text-muted-foreground" },
};

export function certExpiryLabel(c: RouteCertificate): string {
  if (!c.notAfter) return "–";
  const date = new Date(c.notAfter).toLocaleDateString();
  if (c.daysRemaining === null) return date;
  if (c.daysRemaining < 0) return `${date} · expired ${-c.daysRemaining}d ago`;
  return `${date} · in ${c.daysRemaining}d`;
}
