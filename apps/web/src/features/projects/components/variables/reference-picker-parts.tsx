/**
 * Presentational pieces + grouping helpers for the reference picker, split
 * from `reference-picker.tsx` so that component stays within the file-size
 * budget.
 */

import type { TranslationKey } from "@otterdeploy/i18n";

import type { ReactNode } from "react";

import { LockKeyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { ProviderMark } from "@/features/vault-providers/kind-logos";
import { Mariadb } from "@/shared/components/ui/svgs/mariadb";
import { Mongodb } from "@/shared/components/ui/svgs/mongodb";
import { Postgresql } from "@/shared/components/ui/svgs/postgresql";
import { Redis } from "@/shared/components/ui/svgs/redis";
import { cn } from "@/shared/lib/utils";

export type RefSourceKind = "database" | "service" | "project" | "environment" | "vault";
export type RefVaultKind = "hashicorp" | "infisical" | "doppler";
export type RefEngine = "postgres" | "redis" | "mariadb" | "mongodb";

export interface RefRow {
  sourceKind: RefSourceKind;
  sourceName: string;
  engine: RefEngine | null;
  vaultKind: RefVaultKind | null;
  key: string;
  token: string;
  isSecret: boolean;
  platform: boolean;
}

export interface RefGroup {
  key: string;
  kind: RefSourceKind;
  engine: RefEngine | null;
  vaultKind: RefVaultKind | null;
  /** Resource name, or "Shared variables" for project/environment scope. */
  label: string;
  /** Small qualifier under the label (e.g. "database", "service"). */
  subKey: TranslationKey;
  items: Array<{ key: string; token: string; isSecret: boolean; platform: boolean }>;
}

const SOURCE_ORDER: Record<RefSourceKind, number> = {
  database: 0,
  service: 1,
  project: 2,
  environment: 3,
  vault: 4,
};

const SUB_KEYS: Record<RefSourceKind, TranslationKey> = {
  database: "refPicker.subDatabase",
  service: "refPicker.subService",
  vault: "refPicker.subVault",
  project: "refPicker.subShared",
  environment: "refPicker.subShared",
};

/** Group rows by source so each token's owner is unambiguous. Databases
 *  first, then services, then shared scopes, then secret managers. */
export function buildRefGroups(rows: RefRow[]): RefGroup[] {
  const map = new Map<string, RefGroup>();
  for (const r of rows) {
    const groupKey = `${r.sourceKind}:${r.sourceName}`;
    const existing = map.get(groupKey);
    if (existing) existing.items.push(r);
    else
      map.set(groupKey, {
        key: groupKey,
        kind: r.sourceKind,
        engine: r.engine,
        vaultKind: r.vaultKind,
        label: r.sourceName,
        subKey: SUB_KEYS[r.sourceKind],
        items: [r],
      });
  }
  return [...map.values()].sort(
    (a, b) => SOURCE_ORDER[a.kind] - SOURCE_ORDER[b.kind] || a.label.localeCompare(b.label),
  );
}

export interface RefSource {
  key: string;
  kind: RefSourceKind;
  engine: RefEngine | null;
  vaultKind: RefVaultKind | null;
  label: string;
}

/** One chip per distinct source, in the same order as the groups. */
export function buildRefSources(rows: RefRow[]): RefSource[] {
  const map = new Map<string, RefSource>();
  for (const r of rows) {
    const key = `${r.sourceKind}:${r.sourceName}`;
    if (!map.has(key))
      map.set(key, {
        key,
        kind: r.sourceKind,
        engine: r.engine,
        vaultKind: r.vaultKind,
        label: r.sourceName,
      });
  }
  return [...map.values()].sort(
    (a, b) => SOURCE_ORDER[a.kind] - SOURCE_ORDER[b.kind] || a.label.localeCompare(b.label),
  );
}

const ENGINE_ICONS: Record<RefEngine, typeof Postgresql> = {
  postgres: Postgresql,
  redis: Redis,
  mariadb: Mariadb,
  mongodb: Mongodb,
};

export function SourceIcon({
  kind,
  engine,
  vaultKind,
}: {
  kind: RefSourceKind;
  engine: RefEngine | null;
  vaultKind: RefVaultKind | null;
}) {
  if (kind === "database" && engine && engine in ENGINE_ICONS) {
    const Icon = ENGINE_ICONS[engine];
    return <Icon className="size-4 shrink-0" />;
  }
  // External secret managers get their provider's brand mark (same
  // treatment as the Secrets page); lock glyph only if the kind is unknown.
  if (kind === "vault") {
    if (vaultKind) {
      return <ProviderMark kind={vaultKind} className="size-4.5 rounded" logoClassName="size-3" />;
    }
    return (
      <HugeiconsIcon
        icon={LockKeyIcon}
        strokeWidth={1.5}
        className="size-4 shrink-0 text-muted-foreground"
      />
    );
  }
  // Generic monospace `{ }` glyph for service / project / environment
  // sources — they share the same neutral treatment.
  return <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{"{ }"}</span>;
}

/** One tap-to-filter chip in the picker's source bar. */
export function SourceChip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-[11px] whitespace-nowrap ring-1 transition-colors",
        active
          ? "bg-accent text-accent-foreground ring-foreground/20"
          : "text-muted-foreground ring-foreground/10 hover:bg-accent/40",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
