// Step_AdvancedDb — connection pooling, Postgres extensions, Redis config, maintenance window.
// Change 4: Tailwind conversion.
import type { ServiceKindDef } from "@/features/projects/data/service-kinds";
import { SectionH, Field, SettingRow } from "./form-primitives";

export function StepAdvancedDb({ kind }: { kind: ServiceKindDef }) {
  const isPg = kind.id === "postgres";
  const isRedis = kind.id === "redis";

  return (
    <>
      <SectionH title="Connection pooling" />
      <div className="card p-4 mt-3">
        <SettingRow
          label={isPg ? "Enable PgBouncer" : "Enable connection pooler"}
          defaultOn
          sub="Front the database with a transaction-mode pooler"
        />
        <div className="grid grid-cols-2 gap-[10px] mt-3">
          <Field label="Pool size">
            <input className="input font-mono" type="number" defaultValue={20} />
          </Field>
          <Field label="Max client connections">
            <input className="input font-mono" type="number" defaultValue={200} />
          </Field>
        </div>
      </div>

      {isPg && (
        <>
          <div className="h-[18px]" />
          <SectionH title="Extensions" sub="Enable extensions on the postgres instance" />
          <div className="card p-4 mt-[10px]">
            {[
              "pgvector — vector similarity search",
              "pgcrypto — cryptographic functions",
              "postgis — geographic queries",
              "pg_stat_statements — query statistics",
              "uuid-ossp — UUID generation",
              "pg_partman — partition manager",
              "timescaledb — time-series",
            ].map((e, i) => (
              <SettingRow
                key={i}
                label={e.split(" — ")[0]}
                sub={e.split(" — ")[1]}
                defaultOn={i < 4}
              />
            ))}
          </div>
        </>
      )}

      {isRedis && (
        <>
          <div className="h-[18px]" />
          <SectionH title="Redis configuration" />
          <div className="card p-4 mt-[10px]">
            <Field label="Eviction policy">
              <select className="input">
                <option>allkeys-lru — evict least recently used</option>
                <option>volatile-lru — evict TTL'd keys least recently used</option>
                <option>noeviction — return errors when full</option>
              </select>
            </Field>
            <div className="h-3" />
            <SettingRow
              label="Persistence (AOF)"
              defaultOn
              sub="Append-only file fsync every second"
            />
            <SettingRow
              label="RDB snapshots"
              defaultOn
              sub="Periodic point-in-time dumps"
            />
          </div>
        </>
      )}

      <div className="h-[18px]" />
      <SectionH title="Maintenance window" sub="When can Otterstack apply patches?" />
      <div className="card p-4 mt-[10px]">
        <div className="grid grid-cols-2 gap-[10px]">
          <Field label="Day">
            <select className="input">
              <option>Sunday</option>
              <option>Saturday</option>
              <option>Monday</option>
            </select>
          </Field>
          <Field label="Window">
            <select className="input">
              <option>03:00 – 05:00 UTC</option>
              <option>09:00 – 11:00 UTC</option>
              <option>15:00 – 17:00 UTC</option>
            </select>
          </Field>
        </div>
      </div>
    </>
  );
}
