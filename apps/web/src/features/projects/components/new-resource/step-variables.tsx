// Step_Variables — environment variables, auto-injected vars, linked secret managers.
// Ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx lines 2397-2599.
// Adapted from local useState to a single variablesField: AnyFieldApi that owns the Var[].
import type { AnyFieldApi } from "@tanstack/react-form";

import type { ServiceKind } from "@/features/projects/data/service-kinds";

import { SectionH, Switch3 } from "./form-primitives";
import { I } from "./icons";

// ────────── Var type ──────────
export interface Var {
  key: string;
  value: string;
  secret: boolean;
}

// ────────── LinkedSecrets ──────────
type LinkedSecrets = Record<string, boolean>;

// ────────── Props ──────────
interface StepVariablesProps {
  variablesField: AnyFieldApi;
  linkedSecretsField: AnyFieldApi;
  kind: ServiceKind | null;
}

export function StepVariables({ variablesField, linkedSecretsField, kind }: StepVariablesProps) {
  const vars = variablesField.state.value as Var[];
  const linkedSecrets = linkedSecretsField.state.value as LinkedSecrets;

  const suggested =
    !kind || kind.group !== "data"
      ? [
          { k: "NODE_ENV", v: "production", source: "auto" as const },
          { k: "PORT", v: "3000", source: "auto" as const },
          {
            k: "DATABASE_URL",
            v: "postgres://helio:•••@postgres.helio.internal:5432/helio",
            source: "linked" as const,
            from: "postgres",
          },
          {
            k: "REDIS_URL",
            v: "redis://cache.helio.internal:6379",
            source: "linked" as const,
            from: "cache",
          },
        ]
      : [];

  return (
    <>
      <SectionH title="Environment variables" sub="Define values to inject at runtime" />

      {suggested.length > 0 && (
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
            <span style={{ flex: 1 }}>Auto-injected</span>
            <span className="badge">
              <I.bolt width={9} height={9} />
              otterstack-managed
            </span>
          </div>
          {suggested.map((s, i) => (
            <div
              key={s.k}
              className="row"
              style={{
                padding: "10px 14px",
                borderBottom: i === suggested.length - 1 ? "none" : "1px solid var(--border)",
              }}
            >
              <span className="font-mono" style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>
                {s.k}
              </span>
              <span className="font-mono text-muted-foreground" style={{ flex: 2, fontSize: 12 }}>
                {s.v}
              </span>
              <span style={{ width: 100, textAlign: "right" }}>
                {s.source === "linked" ? (
                  <span className="badge">
                    <I.link width={9} height={9} />
                    linked · {s.from}
                  </span>
                ) : (
                  <span className="badge">auto</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ height: 18 }} />
      <SectionH
        title="Custom variables"
        sub="Add key/value pairs — toggle the lock to mark a value as secret"
      />
      <div className="card" style={{ marginTop: 10, overflow: "hidden" }}>
        {/* Column header */}
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
          <span style={{ flex: 1 }}>Key</span>
          <span style={{ flex: 2 }}>Value</span>
          <span style={{ width: 60, textAlign: "center" }}>Secret</span>
          <span style={{ width: 36 }} />
        </div>

        {/* Rows */}
        {vars.map((v, i) => (
          <div
            key={i}
            className="row"
            style={{
              padding: "8px 14px",
              borderBottom: i === vars.length - 1 ? "none" : "1px solid var(--border)",
              gap: 8,
            }}
          >
            {/* Key */}
            <span style={{ flex: 1 }}>
              <input
                className="input font-mono"
                type="text"
                value={v.key}
                placeholder="KEY"
                onChange={(e) => {
                  const next = vars.map((x, j) => (j === i ? { ...x, key: e.target.value } : x));
                  variablesField.handleChange(next);
                }}
                style={{ width: "100%" }}
              />
            </span>

            {/* Value */}
            <span style={{ flex: 2 }}>
              <input
                className="input font-mono"
                type={v.secret ? "password" : "text"}
                value={v.value}
                placeholder={v.secret ? "••••••••" : "value"}
                onChange={(e) => {
                  const next = vars.map((x, j) => (j === i ? { ...x, value: e.target.value } : x));
                  variablesField.handleChange(next);
                }}
                style={{ width: "100%" }}
              />
            </span>

            {/* Secret toggle */}
            <span className="flex items-center justify-center" style={{ width: 60 }}>
              <button
                type="button"
                className="btn ghost icon sm"
                title={v.secret ? "Mark as plain" : "Mark as secret"}
                onClick={() => {
                  const next = vars.map((x, j) => (j === i ? { ...x, secret: !x.secret } : x));
                  variablesField.handleChange(next);
                }}
                style={{ color: v.secret ? "var(--fg-1)" : "var(--fg-3)" }}
              >
                <I.lock width={12} height={12} />
              </button>
            </span>

            {/* Remove */}
            <span style={{ width: 36, textAlign: "right" }}>
              <button
                type="button"
                className="btn ghost icon sm"
                onClick={() => {
                  variablesField.handleChange(vars.filter((_, j) => j !== i));
                }}
              >
                <I.x width={11} height={11} />
              </button>
            </span>
          </div>
        ))}

        {/* Add row + import actions */}
        <div
          className="row gap-2"
          style={{
            padding: "10px 14px",
            background: "var(--bg-sunken)",
            borderTop: vars.length > 0 ? "1px solid var(--border)" : "none",
          }}
        >
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              variablesField.handleChange([...vars, { key: "", value: "", secret: false }]);
            }}
          >
            <I.plus width={11} height={11} /> Add variable
          </button>
          <button type="button" className="btn sm">
            <I.upload width={11} height={11} /> Upload .env
          </button>
          <button type="button" className="btn sm">
            <I.copy width={11} height={11} /> Paste from clipboard
          </button>
          <div style={{ flex: 1 }} />
          <span className="font-mono text-muted-foreground" style={{ fontSize: 11 }}>
            {vars.length} {vars.length === 1 ? "key" : "keys"}
          </span>
        </div>
      </div>

      <div style={{ height: 18 }} />
      <SectionH
        title="Linked secret managers"
        sub="Pull secrets from external managers — they sync continuously"
      />
      <div className="card" style={{ marginTop: 10, overflow: "hidden" }}>
        {[
          {
            id: "infisical",
            name: "Infisical",
            sub: "paperhouse · helio · /apps",
          },
          {
            id: "vault",
            name: "HashiCorp Vault",
            sub: "vault.paperhouse.dev · kv/helio",
          },
          {
            id: "aws-sm",
            name: "AWS Secrets Manager",
            sub: "us-west-2 · helio/*",
          },
        ].map((p, i) => (
          <div
            key={p.id}
            className="row gap-3"
            style={{
              padding: "12px 14px",
              borderBottom: i === 2 ? "none" : "1px solid var(--border)",
            }}
          >
            <div style={{ width: 26 }}>
              <I.lock width={13} height={13} style={{ color: "var(--fg-3)" }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
              <div
                className="font-mono text-muted-foreground"
                style={{ fontSize: 11, marginTop: 2 }}
              >
                {p.sub}
              </div>
            </div>
            <Switch3
              on={!!linkedSecrets[p.id]}
              onChange={(v) => {
                linkedSecretsField.handleChange({
                  ...linkedSecrets,
                  [p.id]: v,
                });
              }}
            />
          </div>
        ))}
      </div>
    </>
  );
}
