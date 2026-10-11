/**
 * The globe at the start of a domain row, and the card it opens.
 *
 * The globe is the row's one status carrier: its colour and glyph come from
 * {@link domainStatus}, so a host shows exactly one state, worst first. Hover
 * (after a short intent delay) or click opens the card with what that state
 * means, the DNS records to publish when DNS is the problem, the raw error when
 * something failed, the four underlying facts, and the one action that helps.
 * Click and keyboard open it at once, so nothing depends on hovering.
 *
 * Every state treatment is one the app already uses: the toaster's icon set,
 * the Spinner, ErrorState's boxed machine message, and the deployment
 * StatusDot convention of a pulsing warning for work in flight.
 */

import type { IconSvgElement } from "@hugeicons/react";

import {
  ArrowUpRight01Icon,
  GlobalIcon,
  GlobalRefreshIcon,
  GlobalSearchIcon,
  GlobeXIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Spinner } from "@/shared/components/ui/spinner";
import { timeAgo } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";

import type { BaseDomainStatus, DomainView } from "./domains-card-parts";

import { type DomainTone, domainStatus } from "./domain-status";
import { DnsRecords, DomainFacts, ToneIcon } from "./domain-status-parts";

const GLOBE_ICON: Record<DomainTone, IconSvgElement> = {
  ok: GlobalIcon,
  neutral: GlobalIcon,
  off: GlobalIcon,
  progress: GlobalRefreshIcon,
  attention: GlobalSearchIcon,
  error: GlobeXIcon,
};

const GLOBE_CLASS: Record<DomainTone, string> = {
  ok: "text-success",
  neutral: "text-muted-foreground",
  off: "text-muted-foreground/50",
  progress: "animate-pulse text-warning motion-reduce:animate-none",
  attention: "text-warning",
  error: "text-destructive",
};

export interface DomainGlobeProps {
  domain: DomainView;
  baseDomainStatus: BaseDomainStatus | undefined;
  orgSlug: string;
  recheck: { run: () => void; pending: boolean };
  onResume: () => void;
  /** Opens the shared DNS dialog (Cloudflare one-click lives there). */
  onConfigureDns: () => void;
  busy: boolean;
}

export function DomainGlobe(props: DomainGlobeProps) {
  const { t } = useTranslation();
  const { domain } = props;
  const status = domainStatus(domain, props.baseDomainStatus);
  const title = t(`domains.state.${status.kind}.title`);

  return (
    <Popover>
      <PopoverTrigger
        // Intent delay filters a pointer passing over the list; click and
        // Enter open at once, so the card never depends on hovering.
        openOnHover
        delay={1000}
        closeDelay={200}
        aria-label={t("domains.globeLabel", { domain: domain.domain, state: title })}
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-md transition-colors outline-none",
          "hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:bg-muted",
          GLOBE_CLASS[status.tone],
        )}
      >
        <HugeiconsIcon icon={GLOBE_ICON[status.tone]} strokeWidth={2} className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[26rem] max-w-[calc(100vw-2rem)] gap-3 p-3.5">
        <DomainStatusBody {...props} />
      </PopoverContent>
    </Popover>
  );
}

function DomainStatusBody({
  domain,
  baseDomainStatus,
  orgSlug,
  recheck,
  onResume,
  onConfigureDns,
  busy,
}: DomainGlobeProps) {
  const { t } = useTranslation();
  const status = domainStatus(domain, baseDomainStatus);
  const error =
    status.kind === "edgeFailed"
      ? domain.edgeError
      : status.kind === "certFailed"
        ? domain.certError
        : null;

  return (
    <>
      <div className="flex items-center gap-2">
        <ToneIcon tone={status.tone} />
        <span className="font-medium">{t(`domains.state.${status.kind}.title`)}</span>
        {domain.dnsCheckedAt ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {t("domains.checked", { ago: timeAgo(domain.dnsCheckedAt) })}
          </span>
        ) : null}
      </div>
      <p className="text-[12.5px] leading-relaxed text-pretty text-muted-foreground">
        {t(`domains.state.${status.kind}.body`)}
      </p>

      {status.showRecords ? <DnsRecords domain={domain} /> : null}

      {error ? (
        // ErrorState's machine message: verbatim, mono, boxed, height-capped.
        <p className="max-h-24 overflow-y-auto rounded border bg-background px-2 py-1 font-mono text-[11px] break-words text-muted-foreground">
          {error}
        </p>
      ) : null}

      <DomainFacts domain={domain} />

      {status.action || status.showRecords || domain.status === "live" ? (
        <div className="flex items-center gap-2">
          {status.showRecords ? (
            <button
              type="button"
              onClick={onConfigureDns}
              className="text-xs text-muted-foreground underline decoration-muted-foreground/50 underline-offset-3 hover:text-foreground"
            >
              {t("domains.cloudflareLink")}
            </button>
          ) : null}
          <span className="ml-auto" />
          {status.action === "recheck" ? (
            <Button size="sm" onClick={recheck.run} disabled={busy}>
              {recheck.pending ? (
                <Spinner className="size-3.5" />
              ) : (
                <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
              )}
              {t("domains.recheckDns")}
            </Button>
          ) : status.action === "resume" ? (
            <Button size="sm" variant="outline" onClick={onResume} disabled={busy}>
              {t("domains.resume")}
            </Button>
          ) : status.action === "edgeLogs" ? (
            <Button
              size="sm"
              variant="outline"
              render={<Link to="/$orgSlug/edge" params={{ orgSlug }} />}
            >
              <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} />
              {t("domains.openEdgeLogs")}
            </Button>
          ) : domain.status === "live" ? (
            <Button
              size="sm"
              variant="ghost"
              render={<a href={`https://${domain.domain}`} target="_blank" rel="noreferrer" />}
            >
              {t("domains.openSite")}
              <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} />
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
