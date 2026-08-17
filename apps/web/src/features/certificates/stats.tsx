import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";

/** Summary tiles above the certificate tables, computed from LIVE probe data
 *  plus the stored custom-cert rows; nothing here is synthesized. */
import type { CertificateInventory, CustomCertificate } from "./data/certificates";

export function CertificateStats({
  inventory,
  customs,
}: {
  inventory: CertificateInventory | undefined;
  customs: CustomCertificate[] | undefined;
}) {
  const { t } = useTranslation();
  const probes = inventory?.certificates ?? [];
  const total = probes.length;
  // ACME-managed = the edge serves a real (non-self-signed) cert that isn't
  // one of our uploads: Caddy obtained and auto-renews it.
  const acme = probes.filter((p) => p.ok && !p.selfSigned && p.customCertificateId === null).length;
  const expiring = probes.filter((p) => p.status === "expiring" || p.status === "expired").length;
  const custom = customs?.length ?? 0;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label={t("certificates.stats.publicDomains")}
        value={inventory ? String(total) : "–"}
        sub={inventory ? `probed via ${inventory.edgeHost}` : "probing…"}
      />
      <Stat
        label={t("certificates.stats.acmeManaged")}
        value={inventory ? String(acme) : "–"}
        sub="auto-renewed by Caddy"
      />
      <Stat
        label={t("certificates.stats.expiringSoon")}
        value={inventory ? String(expiring) : "–"}
        sub={expiring > 0 ? "includes expired" : "nothing due"}
        tone={expiring > 0 ? "warn" : undefined}
      />
      <Stat
        label={t("certificates.stats.customUploads")}
        value={customs ? String(custom) : "–"}
        sub={custom > 0 ? "manual rotation required" : "none uploaded"}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "warn";
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-card p-3.5">
      <div className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={cn("text-2xl font-semibold tracking-tight", tone === "warn" && "text-amber-500")}
      >
        {value}
      </div>
      <div className="truncate text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
