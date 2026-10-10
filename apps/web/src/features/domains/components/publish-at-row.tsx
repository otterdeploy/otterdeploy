/**
 * "New services publish at": the hostname the resolver mints today, so the
 * page shows its effect instead of describing it. Comes from the server's own
 * resolver (`checkBaseDomainDns.publishing`), so an unset domain honestly
 * reads as the sslip.io address with a self-signed certificate.
 */

import type { orpc } from "@/shared/server/orpc";

import { previewSuffix as computePreview, publishNote } from "../lib/base-domain-copy";
import { ServerIp } from "./server-ip";

type BaseDomainDns = Awaited<ReturnType<typeof orpc.organization.checkBaseDomainDns.call>>;

function rowModel(dns: BaseDomainDns | undefined) {
  return {
    publishing: dns?.publishing,
    serverIp: dns?.serverIp ?? null,
    serverIpHidden: dns?.serverIpHidden ?? false,
    wildcard: dns?.wildcard?.state ?? null,
    proxied: dns?.wildcard?.proxied ?? false,
  };
}

export function PublishAtRow({
  dns,
  typed,
  dirty,
  loading,
}: {
  dns: BaseDomainDns | undefined;
  /** The field's value; previewed while it differs from the saved domain. */
  typed: string;
  dirty: boolean;
  loading: boolean;
}) {
  const { publishing, serverIp, serverIpHidden, wildcard, proxied } = rowModel(dns);
  const previewSuffix = dirty
    ? computePreview({ typed, hasServerIp: serverIp !== null || serverIpHidden })
    : null;
  const shown = previewSuffix ?? publishing;
  return (
    <div className="flex items-start justify-between gap-6 px-4 py-3.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] font-medium text-foreground">New services publish at</span>
        <p className="max-w-md text-[12px] leading-relaxed text-muted-foreground">
          {publishing
            ? publishNote({ publishing, wildcard, proxied, preview: previewSuffix !== null })
            : loading
              ? "Checking…"
              : "Couldn't read the current setup."}
        </p>
      </div>
      {shown ? (
        // The two placeholder labels are muted so the part this setting
        // controls (the suffix) is what reads. On sslip.io that includes the
        // server's address, which stays masked.
        <span className="flex max-w-[60%] shrink-0 items-center justify-end gap-0.5 pt-px font-mono text-[12.5px] text-foreground">
          <span className="text-muted-foreground">service-project.</span>
          {shown.onServerIp ? (
            <>
              <ServerIp ip={serverIp} hidden={serverIpHidden} />.
            </>
          ) : null}
          <span className="truncate" title={shown.suffix}>
            {shown.suffix}
          </span>
        </span>
      ) : null}
    </div>
  );
}
