/**
 * Advanced step for database kinds. Only options the provisioner actually
 * honors get controls:
 *
 *   - Postgres extensions ARE consumed (manifest `extensions` → CREATE
 *     EXTENSION + image pinning at provision time) — real picker.
 *   - Everything else the old step showed was decorative: no connection
 *     pooler is ever deployed (no PgBouncer/ProxySQL anywhere in the
 *     provisioner), Redis persistence is hardcoded (`--appendonly yes` in
 *     the engine adapter's buildCommand) with no eviction/RDB knobs, and
 *     no maintenance-window scheduler exists. Those controls were removed
 *     rather than shipped as switches that write to nothing — what's left
 *     states the fixed behavior instead.
 */

import type { ServiceKind } from "@/features/projects/data/service-kinds";

import { Card } from "@/shared/components/ui/card";

import { SectionHeader } from "../form-primitives";
import { PostgresExtensionsSection } from "./postgres-extensions-section";

export function StepAdvancedDb({ kind }: { kind: ServiceKind }) {
  const isPg = kind.id === "postgres";
  const isRedis = kind.id === "redis";

  return (
    <>
      {isPg && <PostgresExtensionsSection />}

      {isRedis && (
        <>
          <SectionHeader
            title="Redis configuration"
            sub="Fixed by the provisioner today — eviction and snapshot tuning aren't configurable yet"
          />
          <Card className="mt-2.5 gap-0 p-4">
            <InfoRow
              label="Persistence"
              value={
                <>
                  Append-only file enabled (<code className="font-mono">--appendonly yes</code>),
                  written to the <code className="font-mono">/data</code> volume
                </>
              }
            />
            <InfoRow
              label="Auth"
              value="A generated password is required on every connection (requirepass)"
              last
            />
          </Card>
        </>
      )}

      {!isPg && !isRedis && (
        <>
          <SectionHeader title="Advanced" />
          <Card className="mt-2.5 p-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              No engine-specific options for {kind.name} yet. Connection details, users, and backups
              are managed on the resource pages after it deploys.
            </p>
          </Card>
        </>
      )}
    </>
  );
}

function InfoRow({
  label,
  value,
  last,
}: {
  label: string;
  value: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-3 py-2 text-xs ${last ? "" : "border-b border-border/60"}`}
    >
      <span className="w-24 shrink-0 pt-px text-[11px] text-muted-foreground">{label}</span>
      <span className="flex-1 leading-relaxed text-foreground/90">{value}</span>
    </div>
  );
}
