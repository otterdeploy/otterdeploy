/**
 * Presentational pieces for the service Domains card — the connection-status
 * badge, the inline edit row, the per-domain action buttons, and the DNS
 * hint. Pulled into a sibling module so {@link ServiceDomainsCard} and its
 * {@link DomainRow} stay small. All pieces are stateless — handlers and busy
 * flags come in as props.
 */

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Spinner } from "@/shared/components/ui/spinner";

export type DnsState = "pointed" | "proxied" | "unpointed" | "unknown";

export interface DomainView {
  id: string;
  domain: string;
  source: "generated" | "custom";
  isPrimary: boolean;
  status: "live" | "disabled";
  dnsState: DnsState;
  dnsCheckedAt: string | null;
  usesAcme: boolean;
  protected: boolean;
  dnsTarget: string | null;
}

/** Connection chip. Generated hosts are always reachable (ours), so they
 *  just read Live/Disabled. Custom hosts surface their DNS reachability:
 *  pointed → cert issues here, proxied → Cloudflare serves TLS, unpointed →
 *  needs the A record below. */
export function StatusBadge({ domain }: { domain: DomainView }) {
  if (domain.status === "disabled") {
    return <Badge variant="outline">Disabled</Badge>;
  }
  if (domain.source === "generated") {
    return <Badge variant="outline">Live</Badge>;
  }
  switch (domain.dnsState) {
    case "pointed":
      return <Badge variant="outline">{domain.usesAcme ? "Connected" : "Live"}</Badge>;
    case "proxied":
      return <Badge variant="secondary">Cloudflare</Badge>;
    case "unpointed":
      return <Badge variant="destructive">DNS not pointed</Badge>;
    default:
      return <Badge variant="secondary">Checking…</Badge>;
  }
}

export function DomainEditRow({
  value,
  onChange,
  onSave,
  saving,
  onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 min-w-0 flex-1 font-mono text-[12.5px]"
        spellCheck={false}
        autoCapitalize="off"
      />
      <Button size="sm" onClick={onSave} disabled={saving || value.trim().length === 0}>
        {saving ? <Spinner className="size-3.5" /> : "Save"}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

export function DomainRowActions({
  domain,
  busy,
  recheckPending,
  needsDns,
  onRecheck,
  onSetPrimary,
  onEdit,
  onRemove,
}: {
  domain: DomainView;
  busy: boolean;
  recheckPending: boolean;
  needsDns: boolean;
  onRecheck: () => void;
  onSetPrimary: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1">
      {domain.source === "custom" && (
        <Button
          size="xs"
          variant={needsDns ? "secondary" : "ghost"}
          onClick={onRecheck}
          disabled={busy}
        >
          {recheckPending ? <Spinner className="size-3" /> : "Recheck DNS"}
        </Button>
      )}
      {!domain.isPrimary && domain.status === "live" && (
        <Button size="xs" variant="ghost" onClick={onSetPrimary} disabled={busy}>
          Set primary
        </Button>
      )}
      <Button size="xs" variant="ghost" onClick={onEdit} disabled={busy}>
        Edit
      </Button>
      <Button
        size="xs"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={onRemove}
        disabled={busy}
      >
        Remove
      </Button>
    </div>
  );
}

/** The DNS record to publish so a custom host points at us. Once it
 *  resolves here, the certificate issues automatically — no extra step. */
export function DnsHint({ domain }: { domain: DomainView }) {
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-muted/30 px-3 py-2 text-[11.5px]">
      <p className="mb-2 text-muted-foreground">
        {domain.dnsTarget
          ? "Add this DNS record at your provider, then Recheck. The certificate issues automatically once it resolves here."
          : "Point this domain at your server, then Recheck. The certificate issues automatically once it resolves here."}
      </p>
      {domain.dnsTarget && (
        <div className="flex flex-col gap-2 font-mono">
          <DnsRecord type="A" name={domain.domain} value={domain.dnsTarget} />
        </div>
      )}
    </div>
  );
}

/** A single DNS record line. Type + name share a row that wraps, and the
 *  value sits below so long record names and tokens both flow full-width
 *  instead of collapsing into a thin, character-wrapped column. */
function DnsRecord({ type, name, value }: { type: string; name: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex min-w-0 items-baseline gap-2 text-muted-foreground">
        <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium tracking-wide uppercase">
          {type}
        </span>
        <span className="min-w-0 break-all">{name}</span>
      </div>
      <span className="pl-1 break-all text-foreground">{value}</span>
    </div>
  );
}
