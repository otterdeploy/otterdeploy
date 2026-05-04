import { useEffect, useState, type ReactNode } from "react";

import { I } from "../icons";

type Props = { open: boolean; onClose: () => void; onDeploy: (name: string) => void };

type SourceId = "github" | "image" | "template" | "empty";

export function DeployModal({ open, onClose, onDeploy }: Props) {
  const [step, setStep] = useState(0);
  const [source, setSource] = useState<SourceId>("github");
  const [name, setName] = useState("notifier");
  const [repo, setRepo] = useState("paperhouse/helio-notifier");
  const [, setBuilding] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!open) {
      setStep(0);
      setBuilding(false);
      setProgress(0);
    }
  }, [open]);

  if (!open) return null;

  const startBuild = () => {
    setStep(2);
    setBuilding(true);
    let p = 0;
    const tick = () => {
      p += Math.random() * 18 + 4;
      if (p >= 100) {
        setProgress(100);
        setTimeout(() => {
          onDeploy(name);
          onClose();
        }, 700);
        return;
      }
      setProgress(p);
      setTimeout(tick, 220);
    };
    tick();
  };

  const sourceOptions: Array<{ id: SourceId; label: string; sub: string; icon: typeof I.github }> = [
    { id: "github", label: "GitHub repo", sub: "Build from a Git ref", icon: I.github },
    { id: "image", label: "Docker image", sub: "Pull an image from a registry", icon: I.service },
    { id: "template", label: "From template", sub: "40+ ready-made stacks", icon: I.graph },
    { id: "empty", label: "Empty service", sub: "I’ll wire it up later", icon: I.plus },
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.4)",
        display: "grid",
        placeItems: "center",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 15 }}>Deploy a new service</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {["Source", "Configure", "Build"][step]}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>

        <div style={{ padding: 20 }}>
          {step === 0 && (
            <div className="col gap-4">
              <div className="muted" style={{ fontSize: 13 }}>
                Pick a source. Otterstack will build and deploy to{" "}
                <b style={{ color: "var(--fg)" }}>production</b>.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {sourceOptions.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setSource(opt.id)}
                    style={{
                      padding: 14,
                      textAlign: "left",
                      border: `1px solid ${source === opt.id ? "var(--fg)" : "var(--border)"}`,
                      borderRadius: 8,
                      background: "var(--bg)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      cursor: "pointer",
                    }}
                  >
                    <opt.icon width={16} height={16} style={{ color: "var(--fg-2)" }} />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{opt.label}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {opt.sub}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
                <button className="btn" onClick={onClose}>
                  Cancel
                </button>
                <button className="btn primary" onClick={() => setStep(1)}>
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="col gap-4">
              <Field label="Service name" hint="Lowercase, used as DNS hostname">
                <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Repository" hint="github.com/…">
                <input className="input mono" value={repo} onChange={(e) => setRepo(e.target.value)} />
              </Field>
              <Field label="Branch">
                <input className="input mono" defaultValue="main" />
              </Field>
              <Field label="Build command">
                <input className="input mono" defaultValue="pnpm build" />
              </Field>
              <Field label="Start command">
                <input className="input mono" defaultValue="pnpm start" />
              </Field>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
                <button className="btn" onClick={() => setStep(0)}>
                  Back
                </button>
                <button className="btn primary" onClick={startBuild}>
                  Build &amp; deploy →
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="col gap-4">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: progress >= 100 ? "var(--ok)" : "var(--info)",
                    boxShadow: progress < 100 ? "0 0 0 4px var(--info-bg)" : "none",
                    animation: progress < 100 ? "pulse 1.4s ease-in-out infinite" : "none",
                  }}
                />
                <span style={{ fontWeight: 500 }}>
                  {progress >= 100 ? "Deployed" : "Building"}{" "}
                  <span className="mono muted" style={{ fontSize: 12 }}>
                    {name}
                  </span>
                </span>
                <div style={{ flex: 1 }} />
                <span className="mono muted" style={{ fontSize: 12 }}>
                  {Math.round(progress)}%
                </span>
              </div>
              <div style={{ height: 4, background: "var(--bg-overlay)", borderRadius: 2, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${progress}%`,
                    background: progress >= 100 ? "var(--ok)" : "var(--fg)",
                    transition: "width 200ms",
                  }}
                />
              </div>
              <BuildLogStream progress={progress} name={name} />
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } }`}</style>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <label style={{ fontSize: 12, fontWeight: 500 }}>{label}</label>
        {hint && (
          <span className="muted" style={{ fontSize: 11 }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function BuildLogStream({ progress, name }: { progress: number; name: string }) {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    const all = [
      `→ cloning paperhouse/${name} @ main`,
      `→ resolved 8a2c1f9 (1.2s)`,
      `→ detected: Node.js 20.x`,
      `→ pnpm install --frozen-lockfile`,
      `   added 412 packages in 24s`,
      `→ pnpm build`,
      `   ✓ Compiled successfully`,
      `   ✓ Linting passed`,
      `→ docker buildx build .`,
      `   layer 1/8 cached`,
      `   layer 5/8 354ms`,
      `→ pushing image to local registry`,
      `→ provisioning replica 1/1`,
      `→ healthcheck OK`,
      `✓ live at https://${name}.helio.so`,
    ];
    const want = Math.min(all.length, Math.floor((progress / 100) * all.length));
    setLines(all.slice(0, want));
  }, [progress, name]);

  return (
    <div
      className="mono"
      style={{
        background: "var(--bg-sunken)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: 12,
        fontSize: 12,
        maxHeight: 200,
        overflow: "auto",
        lineHeight: 1.65,
        color: "var(--fg-2)",
      }}
    >
      {lines.map((l, i) => (
        <div
          key={i}
          style={{
            color: l.startsWith("✓") ? "var(--ok)" : l.startsWith("   ") ? "var(--fg-3)" : "var(--fg)",
          }}
        >
          {l}
        </div>
      ))}
    </div>
  );
}
