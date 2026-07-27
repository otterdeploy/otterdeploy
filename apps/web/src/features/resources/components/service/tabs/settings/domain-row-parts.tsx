/**
 * The interactive pieces of one domain row: the target-port picker, the
 * inline edit row, and the copy / edit / remove icon actions.
 *
 * Split from ./domains-card-parts (which keeps the status chip and the DNS
 * hint) so neither file carries the other's concerns. All stateless —
 * handlers and busy flags come in as props.
 */

import type { IconSvgElement } from "@hugeicons/react";

import { Copy01Icon, Delete02Icon, PencilEdit02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { NativeSelect } from "@/shared/components/ui/native-select";
import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";

import type { DomainView } from "./domains-card-parts";

/** The container ports a host may be routed at. Empty means the service
 *  declares none — the caller hides the picker rather than offering nothing. */
export interface PortChoice {
  containerPort: number;
  appProtocol: "http" | "tcp";
  isPrimary: boolean;
}

/** Which container port a domain forwards to. A single-port service gets a
 *  plain label — a dropdown with one option is a question with one answer. */
export function PortPicker({
  value,
  ports,
  onChange,
  disabled,
  id,
}: {
  value: number | undefined;
  ports: PortChoice[];
  onChange: (port: number) => void;
  disabled?: boolean;
  id?: string;
}) {
  if (ports.length <= 1) {
    const only = ports[0]?.containerPort ?? value;
    return (
      <div
        className="flex h-8 items-center rounded-md border border-input bg-muted/30 px-2.5 font-mono text-[12.5px] text-muted-foreground"
        aria-label="Target port"
      >
        {only != null ? `:${only}` : "no published port"}
      </div>
    );
  }
  return (
    <NativeSelect
      id={id}
      aria-label="Target port"
      className="h-8 font-mono text-[12.5px]"
      value={value != null ? String(value) : ""}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {ports.map((p) => (
        <option key={p.containerPort} value={p.containerPort}>
          {p.containerPort}
          {p.appProtocol === "tcp" ? " (tcp)" : ""}
        </option>
      ))}
    </NativeSelect>
  );
}

export function DomainEditRow({
  value,
  onChange,
  onSave,
  saving,
  onCancel,
  port,
  ports,
  onPortChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  onCancel: () => void;
  port: number;
  ports: PortChoice[];
  onPortChange: (port: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        className="h-8 min-w-0 flex-1 basis-48 font-mono text-[12.5px]"
        spellCheck={false}
        autoCapitalize="off"
        aria-label="Domain"
      />
      <PortPicker value={port} ports={ports} onChange={onPortChange} disabled={saving} />
      <Button size="sm" onClick={onSave} disabled={saving || value.trim().length === 0}>
        {saving ? <Spinner className="size-3.5" /> : "Save"}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/**
 * Per-host actions. Copy / edit / remove are the three icons that sit on
 * every row — the shape Railway's public-networking list uses, and the three
 * things an operator reaches for most. Recheck DNS and Set primary are
 * conditional and stay worded, because neither is guessable from a glyph.
 */
export function DomainRowActions({
  domain,
  busy,
  recheckPending,
  needsDns,
  copied,
  onCopy,
  onRecheck,
  onSetPrimary,
  onEdit,
  onRemove,
}: {
  domain: DomainView;
  busy: boolean;
  recheckPending: boolean;
  needsDns: boolean;
  copied: boolean;
  onCopy: () => void;
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
      <IconAction
        label={copied ? "Copied" : "Copy URL"}
        icon={copied ? Tick02Icon : Copy01Icon}
        onClick={onCopy}
        className={copied ? "text-primary" : undefined}
      />
      <IconAction label="Edit domain" icon={PencilEdit02Icon} onClick={onEdit} disabled={busy} />
      <IconAction
        label="Remove domain"
        icon={Delete02Icon}
        onClick={onRemove}
        disabled={busy}
        className="hover:text-destructive"
      />
    </div>
  );
}

function IconAction({
  label,
  icon,
  onClick,
  disabled,
  className,
}: {
  label: string;
  icon: IconSvgElement;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "grid size-7 place-items-center rounded text-muted-foreground/70 transition-colors",
        "hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5" />
    </button>
  );
}
