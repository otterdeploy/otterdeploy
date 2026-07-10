/** Presentational field primitives for the registry add/edit dialog. */

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/lib/utils";

import { REGISTRY_KIND_META, REGISTRY_KINDS, type RegistryKind } from "./registry-kinds";

/** Label + control wrapper matching the registries form spacing. */
export function FieldShell({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

/**
 * Logo-tile grid of registry kinds. Picking one pre-fills the host and
 * adapts the field hints below — it's a shortcut, not a stored field.
 */
export function KindPicker({
  value,
  onPick,
}: {
  value: RegistryKind;
  onPick: (kind: RegistryKind) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Registry</Label>
      <div role="radiogroup" aria-label="Registry kind" className="grid grid-cols-4 gap-1.5">
        {REGISTRY_KINDS.map((meta) => {
          const selected = value === meta.kind;
          return (
            <button
              key={meta.kind}
              type="button"
              role="radio"
              aria-checked={selected}
              title={meta.fullLabel}
              onClick={() => onPick(meta.kind)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-md border px-1 py-2.5 transition-colors",
                selected
                  ? "border-foreground/40 bg-accent text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
            >
              <SvglLogo search={meta.brand} fallback={meta.label} size={26} />
              <span className="text-[10.5px] leading-none font-medium">{meta.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Registry host field; locked once the credential exists. */
export function HostField({
  value,
  onChange,
  isEdit,
  kind,
}: {
  value: string;
  onChange: (v: string) => void;
  isEdit: boolean;
  kind: RegistryKind;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="reg-host">Registry host</Label>
      <Input
        id="reg-host"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={REGISTRY_KIND_META[kind].hostPlaceholder}
        disabled={isEdit}
        className="font-mono"
      />
      {isEdit && (
        <p className="text-[11px] text-muted-foreground">
          Host is locked. To use a different one, delete this credential and add a new one.
        </p>
      )}
    </div>
  );
}
