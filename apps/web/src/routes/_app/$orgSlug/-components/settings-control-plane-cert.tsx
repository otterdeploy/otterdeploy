/**
 * What the edge is actually serving for the control-plane domain.
 *
 * VERIFIED on the card above means one thing only: the TXT record proved
 * ownership. It never meant TLS works, but it read that way — and when a
 * cloud firewall blocked inbound 80/443, the card cheerfully linked to an
 * https:// URL that could not load while Caddy quietly served `tls internal`.
 * This strip states the second fact separately, so "verified" and "reachable
 * over HTTPS" can never be confused again.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { orpc } from "@/shared/server/orpc";

export function ControlPlaneCertificateNote({
  organizationId,
  domain,
}: {
  organizationId: OrganizationId;
  domain: string;
}) {
  const { t } = useTranslation();
  const query = useQuery(
    orpc.organization.controlPlaneCertificate.queryOptions({ input: { organizationId } }),
  );

  const link = (
    <a
      href={`https://${domain}`}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-foreground underline underline-offset-2"
    >
      https://{domain}
    </a>
  );

  // Until the probe answers, say nothing rather than flash a claim we may be
  // about to contradict.
  if (query.isLoading || !query.data) {
    return <div className="text-[11.5px] text-muted-foreground">{t("instanceNetwork.certChecking")}</div>;
  }

  const { status, issuer } = query.data;

  // A real, publicly-trusted certificate: the only case that earns the link.
  // `expiring` still works today, and Caddy renews ~30d out, so it reads the
  // same rather than crying wolf.
  if (status === "valid" || status === "expiring") {
    return (
      <div className="text-[11.5px] text-muted-foreground">
        {t("instanceNetwork.certLiveBefore")}
        {link}
        {t("instanceNetwork.certLiveAfter", { issuer: issuer ?? "" })}
      </div>
    );
  }

  if (status === "unset") return null;

  // Everything below is the honest-about-system-state case: the domain is
  // verified but HTTPS does not work, and the operator needs the likely cause
  // named rather than a link that fails.
  const message =
    status === "internal"
      ? t("instanceNetwork.certSelfSigned", { issuer: issuer ?? "" })
      : status === "expired"
        ? t("instanceNetwork.certExpired")
        : t("instanceNetwork.certMissing");

  return (
    <div className="rounded-sm border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11.5px] text-muted-foreground">
      {message} {t("instanceNetwork.certBlockedHint")}
    </div>
  );
}
