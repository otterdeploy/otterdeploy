/**
 * "Configure DNS Records": the one dialog every add-a-domain surface shows.
 *
 * Service custom domains, the control-plane FQDN and the workspace base domain
 * all need the same two things published, and each used to explain that its own
 * way. This is the single explanation.
 *
 * Three states, decided by `dns.inspect`:
 *
 *   Cloudflare + token   → one-click Configure. We write the records.
 *   Cloudflare, no token → Connect Cloudflare, plus the manual records so the
 *                          operator is never blocked on connecting.
 *   anything else        → manual records only.
 *
 * The manual records are always rendered, in every state. A one-click path that
 * hides the underlying records leaves someone with no way to check what was
 * created or to fix it by hand when it goes wrong.
 */

import { Alert02Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Cloudflare } from "@/shared/components/ui/svgs/cloudflare";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

export interface DnsRecordRow {
  type: "A" | "TXT" | "CNAME";
  /** Fully-qualified name. */
  name: string;
  /** Zone-relative name when known: what a DNS provider's UI actually wants.
   *  Pasting the FQDN into Cloudflare creates `waves.acme.com.acme.com`. */
  relativeName?: string | null;
  value: string;
}

function CopyCell({ text, mono = true }: { text: string; mono?: boolean }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      // `copyToClipboard`, not `navigator.clipboard`: this dialog is reached
      // over plain http://<ip> on most self-hosted installs, where the async
      // Clipboard API doesn't exist at all. The bare call threw before the
      // toast ran, so the row just did nothing. See shared/lib/clipboard.ts.
      onClick={() => {
        void copyToClipboard(text).then((ok) =>
          ok ? toast.success(t("common.copied")) : toast.error(t("common.copyFailed")),
        );
      }}
      className={cn(
        "group flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-accent",
        mono && "font-mono",
      )}
      title={text}
    >
      <span className="truncate">{text}</span>
      <HugeiconsIcon
        icon={Copy01Icon}
        strokeWidth={2}
        className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}

/** The Cloudflare-detected header row: either "we can do this for you" or
 *  "connect a token and we can". Only ever rendered when the zone is on
 *  Cloudflare, so it states that as fact. */
function OneClickRow({
  canAuto,
  autoConfiguring,
  onAutoConfigure,
  connectHref,
}: {
  canAuto: boolean;
  autoConfiguring: boolean;
  onAutoConfigure?: () => void;
  connectHref?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="flex min-w-0 items-center gap-3">
        <Cloudflare aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-medium">{t("dns.oneClick.title")}</span>
          <span className="text-[11px] text-muted-foreground">
            {canAuto ? t("dns.oneClick.canAuto") : t("dns.oneClick.needsToken")}
          </span>
        </div>
      </div>
      {canAuto ? (
        <Button size="sm" disabled={autoConfiguring} onClick={onAutoConfigure}>
          {autoConfiguring ? t("dns.oneClick.configuring") : t("dns.oneClick.configure")}
        </Button>
      ) : connectHref ? (
        <Button
          size="sm"
          variant="outline"
          render={<a href={connectHref}>{t("dns.oneClick.connect")}</a>}
        />
      ) : null}
    </div>
  );
}

/** The records themselves, click-to-copy. Empty only before the domain is
 *  saved. There is no "this provider needs no records" case. */
function RecordsTable({ records }: { records: DnsRecordRow[] }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-[12px]">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">{t("dns.table.type")}</th>
            <th className="px-2 py-1.5 text-left font-medium">{t("dns.table.name")}</th>
            <th className="px-2 py-1.5 text-left font-medium">{t("dns.table.value")}</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={`${r.type}:${r.name}`} className="border-t">
              <td className="px-2 py-1.5 font-mono">{r.type}</td>
              <td className="max-w-[16rem] px-1 py-1">
                <CopyCell text={r.relativeName ?? r.name} />
              </td>
              <td className="max-w-[20rem] px-1 py-1">
                <CopyCell text={r.value} />
              </td>
            </tr>
          ))}
          {records.length === 0 ? (
            <tr className="border-t">
              <td colSpan={3} className="px-2 py-3 text-center text-muted-foreground">
                {t("dns.table.empty")}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/** Shown only once `proxied` is definitely true. `address` is the first
 *  resolved address when we have one. It makes the warning checkable rather
 *  than something the operator has to take on faith. */
function ProxiedWarning({ address }: { address: string | undefined }) {
  const { t } = useTranslation();
  return (
    <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning-foreground">
      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="mt-px size-3.5 shrink-0" />
      <span>{t("dns.proxiedWarning", { address: address ?? "" })}</span>
    </p>
  );
}

export function DnsRecordsDialog({
  open,
  onOpenChange,
  domain,
  records,
  /** Runs the provider's one-click setup. Omit when the surface has no
   *  auto-configure endpoint yet: the dialog then stays manual-only. */
  onAutoConfigure,
  autoConfiguring = false,
  /** Where "Connect Cloudflare" sends someone. */
  connectHref,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  domain: string;
  records: DnsRecordRow[];
  onAutoConfigure?: () => void;
  autoConfiguring?: boolean;
  connectHref?: string;
}) {
  const { t } = useTranslation();
  const inspect = useQuery({
    ...orpc.dns.inspect.queryOptions({ input: { domain } }),
    // Only ask once the dialog is actually open. This does live DNS lookups.
    enabled: open && domain.length > 0,
    staleTime: 30_000,
    meta: { suppressErrorToast: true },
  });

  const info = inspect.data;
  const isCloudflare = info?.provider === "cloudflare";
  const canAuto = Boolean(info?.cloudflare.canAutoConfigure) && Boolean(onAutoConfigure);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("dns.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {info?.zone
              ? t("dns.dialogDescriptionZone", { zone: info.zone })
              : t("dns.dialogDescription")}
          </DialogDescription>
        </DialogHeader>

        {inspect.isLoading ? (
          <Skeleton className="h-16 rounded-md" />
        ) : isCloudflare ? (
          <OneClickRow
            canAuto={canAuto}
            autoConfiguring={autoConfiguring}
            onAutoConfigure={onAutoConfigure}
            connectHref={connectHref}
          />
        ) : null}

        {/* Deliberately shown even when one-click is available: an automated
            path that hides what it wrote leaves nothing to verify against. */}
        <RecordsTable records={records} />

        {/* The orange-cloud warning. Only when we KNOW it's proxied, `proxied`
            is nullable precisely so "we couldn't tell" never renders as a
            claim either way. */}
        {info?.proxied === true ? <ProxiedWarning address={info.resolvedAddresses[0]} /> : null}

        {info?.lookupFailed ? (
          <p className="text-[11px] text-muted-foreground">{t("dns.lookupFailed")}</p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
