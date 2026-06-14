/** Presentational field primitives for the registry add/edit dialog. */

import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/lib/utils";

import { HOST_PRESETS } from "./shared";

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

/** Registry host field with presets; locked once the credential exists. */
export function HostField({
  value,
  onChange,
  isEdit,
}: {
  value: string;
  onChange: (v: string) => void;
  isEdit: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="reg-host">Registry host</Label>
      <Input
        id="reg-host"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ghcr.io"
        disabled={isEdit}
        className="font-mono"
      />
      {!isEdit && (
        <div className="flex flex-wrap gap-1.5">
          {HOST_PRESETS.map((h) => (
            <button
              key={h.value}
              type="button"
              title={h.label}
              onClick={() => onChange(h.value)}
              className={cn(
                "rounded-md border px-2 py-1 font-mono text-[11px] transition-colors",
                value === h.value
                  ? "border-foreground bg-accent text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
            >
              {h.value}
            </button>
          ))}
        </div>
      )}
      {isEdit && (
        <p className="text-[11px] text-muted-foreground">
          Host is locked. To use a different one, delete this credential and add
          a new one.
        </p>
      )}
    </div>
  );
}
