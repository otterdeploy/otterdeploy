// Step_Networking — port exposure, health checks, edge proxy settings.
// Ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx lines 1605-1913.
import type { AnyFieldApi } from "@tanstack/react-form";

import type { ServiceKind } from "@/features/projects/data/service-kinds";

import { SectionH, Field, Switch3, SettingRow } from "./form-primitives";
import { I } from "./icons";

export type Port = {
  port: number;
  protocol: string;
  public: boolean;
  host: string;
};

type NetworkingProps = {
  portsField: AnyFieldApi;
  healthPathField: AnyFieldApi;
  healthIntervalField: AnyFieldApi;
  kind: ServiceKind | null;
};

export function StepNetworking({
  portsField,
  healthPathField,
  healthIntervalField,
  kind,
}: NetworkingProps) {
  const ports = portsField.state.value as Port[];
  const healthPath = healthPathField.state.value as string;
  const healthInterval = healthIntervalField.state.value as string;

  const isWorker = kind?.id === "worker";
  const isCron = kind?.id === "cron";
  const isStatic = kind?.id === "static";

  if (isCron) {
    return (
      <>
        <SectionH title="Schedule" sub="When should this job run?" />
        <div className="card" style={{ padding: 16, marginTop: 12 }}>
          <Field label="Cron expression">
            <input className="input mono" defaultValue="0 3 * * *" />
            <div className="muted mono" style={{ fontSize: 11, marginTop: 4 }}>
              Every day at 03:00 UTC · next run in 7h 12m
            </div>
          </Field>
          <div style={{ height: 10 }} />
          <Field label="Timezone">
            <select className="input">
              <option>UTC</option>
              <option>America/Los_Angeles</option>
              <option>Europe/London</option>
            </select>
          </Field>
          <div style={{ height: 10 }} />
          <Field label="Command">
            <input className="input mono" defaultValue="node scripts/cleanup.js" />
          </Field>
          <div style={{ height: 10 }} />
          <Field label="Max runtime">
            <input className="input mono" defaultValue="30m" />
          </Field>
        </div>
        <div style={{ height: 14 }} />
        <div className="card" style={{ padding: 16 }}>
          <SettingRow
            label="Skip if previous run still active"
            sub="Don't pile up overlapping invocations"
            defaultOn
          />
          <SettingRow label="Alert on failure" defaultOn sub="Send to #ops Slack channel" />
        </div>
      </>
    );
  }

  if (isWorker) {
    return (
      <>
        <SectionH
          title="Workers don't expose ports"
          sub="No HTTP listener — this service runs a long process"
        />
        <div className="card" style={{ padding: 16, marginTop: 12 }}>
          <Field label="Process command">
            <input className="input mono" defaultValue="celery -A app worker --loglevel=info" />
          </Field>
          <div style={{ height: 10 }} />
          <Field label="Graceful shutdown timeout">
            <input className="input mono" defaultValue="30s" />
          </Field>
          <div style={{ height: 10 }} />
          <Field label="Liveness probe">
            <input
              className="input mono"
              placeholder="optional · exec command, e.g. celery inspect ping"
            />
          </Field>
        </div>
      </>
    );
  }

  return (
    <>
      <SectionH title="Ports" sub="Which container ports should be exposed?" />
      <div className="card" style={{ marginTop: 12, overflow: "hidden" }}>
        <div
          className="row"
          style={{
            padding: "10px 14px",
            background: "var(--bg-sunken)",
            borderBottom: "1px solid var(--border)",
            fontSize: 11,
            color: "var(--fg-3)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontWeight: 600,
          }}
        >
          <span style={{ width: 80 }}>Port</span>
          <span style={{ width: 100 }}>Protocol</span>
          <span style={{ flex: 1 }}>Public hostname</span>
          <span style={{ width: 70 }}>Public</span>
          <span style={{ width: 50 }} />
        </div>
        {ports.map((p, i) => (
          <div
            key={i}
            className="row"
            style={{
              padding: "10px 14px",
              borderBottom: i === ports.length - 1 ? "none" : "1px solid var(--border)",
            }}
          >
            <span style={{ width: 80 }}>
              <input
                className="input mono"
                type="number"
                value={p.port}
                onChange={(e) => {
                  const next = ports.map((x, j) => (j === i ? { ...x, port: +e.target.value } : x));
                  portsField.handleChange(next);
                }}
                style={{ width: 70 }}
              />
            </span>
            <span style={{ width: 100 }}>
              <select
                className="input mono"
                value={p.protocol}
                onChange={(e) => {
                  const next = ports.map((x, j) =>
                    j === i ? { ...x, protocol: e.target.value } : x,
                  );
                  portsField.handleChange(next);
                }}
                style={{ width: 90 }}
              >
                <option value="http">HTTP</option>
                <option value="http2">HTTP/2</option>
                <option value="grpc">gRPC</option>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
              </select>
            </span>
            <span style={{ flex: 1, paddingRight: 10 }}>
              <input
                className="input mono"
                value={p.host}
                onChange={(e) => {
                  const next = ports.map((x, j) => (j === i ? { ...x, host: e.target.value } : x));
                  portsField.handleChange(next);
                }}
                disabled={!p.public}
                style={{ width: "100%", opacity: p.public ? 1 : 0.5 }}
              />
            </span>
            <span style={{ width: 70 }}>
              <Switch3
                on={p.public}
                onChange={(v) => {
                  const next = ports.map((x, j) => (j === i ? { ...x, public: v } : x));
                  portsField.handleChange(next);
                }}
              />
            </span>
            <span style={{ width: 50, textAlign: "right" }}>
              <button
                type="button"
                className="btn ghost icon sm"
                onClick={() => {
                  portsField.handleChange(ports.filter((_, j) => j !== i));
                }}
              >
                <I.x width={11} height={11} />
              </button>
            </span>
          </div>
        ))}
        <div style={{ padding: "10px 14px" }}>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              portsField.handleChange([
                ...ports,
                { port: 8080, protocol: "http", public: false, host: "" },
              ]);
            }}
          >
            <I.plus width={11} height={11} /> Add port
          </button>
        </div>
      </div>

      {!isStatic && (
        <>
          <div style={{ height: 18 }} />
          <SectionH
            title="Health check"
            sub="How does Otterstack know your service is ready to serve traffic?"
          />
          <div className="card" style={{ padding: 16, marginTop: 10 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr",
                gap: 10,
              }}
            >
              <Field label="Path">
                <input
                  className="input mono"
                  value={healthPath}
                  onChange={(e) => healthPathField.handleChange(e.target.value)}
                />
              </Field>
              <Field label="Interval">
                <input
                  className="input mono"
                  value={healthInterval}
                  onChange={(e) => healthIntervalField.handleChange(e.target.value)}
                />
              </Field>
              <Field label="Timeout">
                <input className="input mono" defaultValue="3s" />
              </Field>
            </div>
            <div style={{ height: 10 }} />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <Field label="Successes before ready">
                <input className="input mono" type="number" defaultValue={2} />
              </Field>
              <Field label="Failures before unhealthy">
                <input className="input mono" type="number" defaultValue={3} />
              </Field>
            </div>
          </div>
        </>
      )}

      <div style={{ height: 18 }} />
      <SectionH title="Edge proxy" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <SettingRow
          label="Auto-issue TLS certificates"
          sub="Let's Encrypt · auto-renewed before expiry"
          defaultOn
        />
        <SettingRow label="HTTP → HTTPS redirect" defaultOn sub="Force secure connections" />
        <SettingRow label="HTTP/3 (QUIC)" defaultOn sub="Serve over QUIC where available" />
        <SettingRow label="Compression (zstd, gzip)" defaultOn sub="Encode responses on the wire" />
        <SettingRow label="WebSocket upgrade" defaultOn sub="Allow ws:// connection upgrades" />
        <SettingRow
          label="Forward X-Forwarded-For"
          defaultOn
          sub="Pass real client IP through to upstream"
        />
      </div>
    </>
  );
}
