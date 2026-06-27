import { useState } from "react";

import { PROJECT, type Env } from "../data";
import { I } from "../icons";

export function EnvSwitcher({ env, setEnv }: { env: Env; setEnv: (e: Env) => void }) {
  const [open, setOpen] = useState(false);
  const cls = env === "production" ? "" : env === "staging" ? "staging" : "preview";
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="row gap-2"
        style={{
          width: "100%",
          padding: "6px 8px",
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--bg-elev)",
          cursor: "pointer",
          fontSize: 12,
          justifyContent: "space-between",
        }}
      >
        <span className="row gap-2">
          <span className={`os-env-dot ${cls}`} />
          <span style={{ fontWeight: 500 }}>{env}</span>
        </span>
        <I.chevDown width={12} height={12} style={{ color: "var(--fg-3)" }} />
      </button>
      {open ? (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 4,
            zIndex: 100,
            boxShadow: "var(--shadow-md)",
          }}
        >
          {PROJECT.envs.map((e) => (
            <button
              key={e}
              onClick={() => {
                setEnv(e);
                setOpen(false);
              }}
              className="row gap-2"
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 4,
                background: env === e ? "var(--bg-overlay)" : "transparent",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <span
                className={`os-env-dot ${e === "production" ? "" : e === "staging" ? "staging" : "preview"}`}
              />
              <span>{e}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
