// Per-service Build & Deploy form. Used by both:
//   - Settings → Build & deploy   (with a service picker on top)
//   - ServiceDetail → Build & deploy
import { useState } from "react";

import { I, type IconKey } from "../../icons";
import { BUILDERS, type Service } from "../../data";
import { BuilderConfig, Field, SectionH, SettingRow } from "../form";

export function BuildForm({ service }: { service: Service }) {
  const [builderId, setBuilderId] = useState("railpack");

  return (
    <div className="col gap-4">
      <SectionH
        title="Source"
        sub={`paperhouse/helio · ${service.branch ?? "main"} · apps/${service.name}`}
      />
      <div className="card" style={{ padding: 16 }}>
        <div className="row gap-3">
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              background: "var(--bg-sunken)",
              border: "1px solid var(--border)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <I.branch width={14} height={14} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
              {service.repo ?? `github.com/paperhouse/helio-${service.name}`}
            </div>
            <div className="muted mono" style={{ fontSize: 11 }}>
              branch: {service.branch ?? "main"} · root: apps/{service.name} ·{" "}
              {service.commit ? service.commit.slice(0, 7) : "no commit"} ·{" "}
              {service.author ?? "unknown"}
            </div>
          </div>
          <button className="btn">
            <I.link width={11} height={11} /> Reconnect
          </button>
        </div>
      </div>

      <SectionH title="Build provider" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {BUILDERS.map((b) => {
          const key = (b.icon as IconKey) in I ? (b.icon as IconKey) : ("doc" as IconKey);
          const Ic = I[key];
          return (
            <button
              key={b.id}
              onClick={() => setBuilderId(b.id)}
              className={`os-builder ${builderId === b.id ? "active" : ""}`}
            >
              {b.popular && <span className="os-builder-pop">popular</span>}
              <div className="row gap-2">
                <div className="os-builder-icon">
                  <Ic width={14} height={14} />
                </div>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{b.name}</span>
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
                {b.sub}
              </div>
            </button>
          );
        })}
      </div>

      <BuilderConfig builderId={builderId} service={service.name} />

      <SectionH title="Deploy" />
      <div className="card" style={{ padding: 16 }}>
        <Field label="Deploy command">
          <input
            className="input mono"
            defaultValue={defaultStartCommand(service.name)}
          />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Watch paths">
          <input
            className="input mono"
            defaultValue={`apps/${service.name}/**, packages/shared/**`}
          />
        </Field>
        <div style={{ height: 12 }} />
        <SettingRow
          label="Auto-deploy on push to main"
          defaultOn
          sub="Trigger a build whenever the watched branch updates"
        />
        <SettingRow
          label="Block deploy on failed health check"
          defaultOn
          sub="Keep old replicas running if /health fails"
        />
        <SettingRow
          label="Zero-downtime rolling deploy"
          defaultOn
          sub="Drain old replicas only after new ones report ready"
        />
      </div>
    </div>
  );
}

function defaultStartCommand(name: string): string {
  if (name === "web") return "pnpm start";
  if (name === "api") return "node dist/server.js";
  if (name === "worker") return "celery -A app worker";
  return "";
}
