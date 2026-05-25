import type { ServiceKind } from "@/features/projects/data/service-kinds";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import { SectionHeader, Field, SettingRow } from "../form-primitives";

const PG_EXTENSIONS = [
  ["pgvector", "vector similarity search"],
  ["pgcrypto", "cryptographic functions"],
  ["postgis", "geographic queries"],
  ["pg_stat_statements", "query statistics"],
  ["uuid-ossp", "UUID generation"],
  ["pg_partman", "partition manager"],
  ["timescaledb", "time-series"],
] as const;

const REDIS_EVICTION_POLICIES = [
  { value: "allkeys-lru", label: "allkeys-lru — evict least recently used" },
  { value: "volatile-lru", label: "volatile-lru — evict TTL'd keys least recently used" },
  { value: "noeviction", label: "noeviction — return errors when full" },
];

const MAINTENANCE_DAYS = ["Sunday", "Saturday", "Monday"];
const MAINTENANCE_WINDOWS = [
  "03:00 - 05:00 UTC",
  "09:00 - 11:00 UTC",
  "15:00 - 17:00 UTC",
];

export function StepAdvancedDb({ kind }: { kind: ServiceKind }) {
  const isPg = kind.id === "postgres";
  const isRedis = kind.id === "redis";

  return (
    <>
      <SectionHeader title="Connection pooling" />
      <Card className="mt-3 rounded-md">
        <CardContent className="flex flex-col gap-3">
          <SettingRow
            label={isPg ? "Enable PgBouncer" : "Enable connection pooler"}
            defaultOn
            sub="Front the database with a transaction-mode pooler"
          />
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Pool size">
              <Input className="font-mono" type="number" defaultValue={20} />
            </Field>
            <Field label="Max client connections">
              <Input className="font-mono" type="number" defaultValue={200} />
            </Field>
          </div>
        </CardContent>
      </Card>

      {isPg && (
        <>
          <div className="h-[18px]" />
          <SectionHeader title="Extensions" sub="Enable extensions on the postgres instance" />
          <Card className="mt-2.5 rounded-md">
            <CardContent>
              {PG_EXTENSIONS.map(([label, sub], i) => (
                <SettingRow key={label} label={label} sub={sub} defaultOn={i < 4} />
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {isRedis && (
        <>
          <div className="h-[18px]" />
          <SectionHeader title="Redis configuration" />
          <Card className="mt-2.5 rounded-md">
            <CardContent className="flex flex-col gap-2.5">
              <Field label="Eviction policy">
                <Select
                  defaultValue="allkeys-lru"
                  items={REDIS_EVICTION_POLICIES}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REDIS_EVICTION_POLICIES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <SettingRow
                label="Persistence (AOF)"
                defaultOn
                sub="Append-only file fsync every second"
              />
              <SettingRow label="RDB snapshots" defaultOn sub="Periodic point-in-time dumps" />
            </CardContent>
          </Card>
        </>
      )}

      <div className="h-[18px]" />
      <SectionHeader title="Maintenance window" sub="When can Otterstack apply patches?" />
      <Card className="mt-2.5 rounded-md">
        <CardContent>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Day">
              <Select
                defaultValue="Sunday"
                items={MAINTENANCE_DAYS.map((d) => ({ label: d, value: d }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAINTENANCE_DAYS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Window">
              <Select
                defaultValue={MAINTENANCE_WINDOWS[0]}
                items={MAINTENANCE_WINDOWS.map((w) => ({ label: w, value: w }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAINTENANCE_WINDOWS.map((w) => (
                    <SelectItem key={w} value={w}>
                      {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
