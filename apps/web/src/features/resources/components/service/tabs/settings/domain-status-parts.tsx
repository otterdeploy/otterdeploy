/**
 * The pieces inside a domain's status card that are not the headline: the
 * state icon, the DNS records to publish, and the four underlying facts. Every
 * treatment is one the app already uses: the toaster's icon set, the Spinner,
 * and the boxed monospace values of the DNS dialog.
 */

import type { IconSvgElement } from "@hugeicons/react";

import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  InformationCircleIcon,
  MultiplicationSignCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/utils";

import type { DomainView } from "./domains-card-parts";

import { type DomainTone, domainFacts } from "./domain-status";

/** The toaster's icon per outcome (shared/components/ui/sonner.tsx). */
const TONE_ICON: Record<
  Exclude<DomainTone, "progress">,
  { icon: IconSvgElement; color: string }
> = {
  ok: { icon: CheckmarkCircle02Icon, color: "text-success" },
  attention: { icon: Alert02Icon, color: "text-warning" },
  error: { icon: MultiplicationSignCircleIcon, color: "text-destructive" },
  neutral: { icon: InformationCircleIcon, color: "text-muted-foreground" },
  off: { icon: InformationCircleIcon, color: "text-muted-foreground" },
};

export function ToneIcon({ tone }: { tone: DomainTone }) {
  if (tone === "progress") return <Spinner className="size-3.5 shrink-0" />;
  const { icon, color } = TONE_ICON[tone];
  return <HugeiconsIcon icon={icon} strokeWidth={2} className={cn("size-3.5 shrink-0", color)} />;
}

/** Same pair the server derives (packages/api/src/lib/dns-records.ts). Built
 *  from the view's own fields rather than refetched: the row already carries
 *  the token and target, and a second round trip would only add a way for the
 *  two to disagree. Shared with the row's Configure DNS dialog. */
export function dnsRecordsFor(domain: DomainView) {
  return [
    ...(domain.verifyRecord && domain.verifyToken
      ? [{ type: "TXT" as const, name: domain.verifyRecord, value: domain.verifyToken }]
      : []),
    ...(domain.dnsTarget
      ? [{ type: "A" as const, name: domain.domain, value: domain.dnsTarget }]
      : []),
  ];
}

export function DnsRecords({ domain }: { domain: DomainView }) {
  const { t } = useTranslation();
  const records = dnsRecordsFor(domain);
  if (records.length === 0) return null;
  return (
    <div className="divide-y rounded-md border">
      {records.map((r) => (
        <div key={r.type} className="flex items-start gap-2.5 px-2.5 py-2">
          <span className="mt-0.5 w-9 shrink-0 rounded bg-muted py-0.5 text-center font-mono text-[10px] font-medium text-muted-foreground">
            {r.type}
          </span>
          <dl className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[11.5px]">
            <dt className="text-muted-foreground">{t("domains.recordName")}</dt>
            <dd className="font-mono break-all text-muted-foreground">{r.name}</dd>
            <dt className="text-muted-foreground">{t("domains.recordValue")}</dt>
            <dd className="font-mono break-all text-foreground">{r.value}</dd>
          </dl>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("domains.copyRecord", { type: r.type })}
            // copyToClipboard, not navigator.clipboard: most installs are
            // reached over plain http, where the async Clipboard API is absent.
            onClick={() => {
              void copyToClipboard(r.value).then((ok) =>
                ok ? toast.success(t("common.copied")) : toast.error(t("common.copyFailed")),
              );
            }}
          >
            <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
          </Button>
        </div>
      ))}
    </div>
  );
}

export function DomainFacts({ domain }: { domain: DomainView }) {
  const { t } = useTranslation();
  return (
    <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[12.5px]">
      {domainFacts(domain).map((f) => (
        <div key={f.key} className="contents">
          <dt className="text-muted-foreground">{t(`domains.factLabel.${f.key}`)}</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {f.tone === "off" ? (
              <span aria-hidden className="w-3.5 text-center text-muted-foreground">
                –
              </span>
            ) : (
              <ToneIcon tone={f.tone} />
            )}
            <span>{t(`domains.fact.${f.value}`)}</span>
            {f.value === "pointsHere" && domain.dnsTarget ? (
              <span className="text-xs text-muted-foreground">
                {t("domains.serverIp")}{" "}
                <span className="font-mono text-[11.5px]">{domain.dnsTarget}</span>
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
