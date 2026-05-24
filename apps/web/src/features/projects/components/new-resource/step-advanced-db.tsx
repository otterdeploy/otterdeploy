// Step_AdvancedDb — connection pooling, Postgres extensions, Redis config, maintenance window.
// Ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx lines 2598-2713.
import type { ServiceKindDef } from "@/features/projects/data/service-kinds";
import { SectionH, Field, SettingRow } from "./form-primitives";

export function StepAdvancedDb({ kind }: { kind: ServiceKindDef }) {
  const isPg = kind.id === "postgres";
  const isRedis = kind.id === "redis";

  return (
    <>
      <SectionH title="Connection pooling" />
      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <SettingRow
          label={isPg ? "Enable PgBouncer" : "Enable connection pooler"}
          defaultOn
          sub="Front the database with a transaction-mode pooler"
        />
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}
        >
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
          <div style={{ height: 18 }} />
          <SectionH title="Extensions" sub="Enable extensions on the postgres instance" />
          <div className="card" style={{ padding: 16, marginTop: 10 }}>
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
          <div style={{ height: 18 }} />
          <SectionH title="Redis configuration" />
          <div className="card" style={{ padding: 16, marginTop: 10 }}>
            <Field label="Eviction policy">
              <select className="input">
                <option>allkeys-lru — evict least recently used</option>
                <option>volatile-lru — evict TTL'd keys least recently used</option>
                <option>noeviction — return errors when full</option>
              </select>
            </Field>
            <div style={{ height: 12 }} />
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

      <div style={{ height: 18 }} />
      <SectionH title="Maintenance window" sub="When can Otterstack apply patches?" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
