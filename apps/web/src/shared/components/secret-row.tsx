/**
 * Shared row for a write-only credential on a settings card.
 *
 * Every secret on these cards behaves identically, and that behaviour is worth
 * stating once: the value is never readable back, so the field shows a
 * placeholder when one is stored and an empty box means "leave it alone" rather
 * than "clear it". Callers omit the field from their mutation when it's blank.
 */

import type { ReactNode } from "react";

import { SettingsRow } from "@/shared/components/settings-section";
import { Badge } from "@/shared/components/ui/badge";
import { Input } from "@/shared/components/ui/input";

export function SecretRow({
  title,
  configured,
  fromEnv = false,
  unsetDescription,
  value,
  onChange,
  disabled,
  stacked = false,
}: {
  title: string;
  /** A secret is already stored. The field becomes "replace, or leave blank". */
  configured: boolean;
  /** The environment supplies this credential, so it works without a stored one. */
  fromEnv?: boolean;
  /** Shown when nothing is stored yet. */
  unsetDescription: ReactNode;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  stacked?: boolean;
}) {
  return (
    <SettingsRow
      stacked={stacked}
      title={title}
      description={
        configured
          ? "A value is stored. Leave blank to keep it, or type a new one to replace it."
          : unsetDescription
      }
      control={
        <div className="flex items-center gap-2.5">
          {fromEnv && !configured && (
            <Badge variant="outline" className="font-mono text-[10px]">
              From env
            </Badge>
          )}
          <Input
            type="password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={configured ? "••••••••" : ""}
            className={stacked ? "font-mono text-[12.5px]" : "font-mono text-[12.5px] sm:w-72"}
            disabled={disabled}
            autoComplete="off"
          />
        </div>
      }
    />
  );
}
