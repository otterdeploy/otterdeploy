/**
 * "New services publish at": the hostname the resolver mints today, so the
 * page shows its effect instead of describing it. Comes from the server's own
 * resolver (`checkBaseDomainDns.publishing`), so an unset domain honestly
 * reads as the sslip.io address with a self-signed certificate.
 */

import { publishNote, type Publishing, type WildcardState } from "../lib/base-domain-copy";

export function PublishAtRow({
  publishing,
  previewSuffix,
  wildcard,
  proxied,
  loading,
}: {
  publishing: Publishing | undefined;
  /** Set while the field holds an unsaved domain. */
  previewSuffix: string | null;
  wildcard: WildcardState | null;
  proxied: boolean;
  loading: boolean;
}) {
  const suffix = previewSuffix ?? publishing?.suffix;
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
      {suffix ? (
        // The two placeholder labels are muted so the part this setting
        // controls (the suffix) is what reads.
        <span
          title={`service-project.${suffix}`}
          className="max-w-[55%] shrink-0 truncate pt-px text-right font-mono text-[12.5px] text-foreground"
        >
          <span className="text-muted-foreground">service-project.</span>
          {suffix}
        </span>
      ) : null}
    </div>
  );
}
