import { useEffect, useRef, useState } from "react";

import { I } from "../icons";

type Cmd = { id: string; label: string; kbd?: string; section: string };

type Props = { open: boolean; onClose: () => void; onAction: (id: string) => void };

export function CommandPalette({ open, onClose, onAction }: Props) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const cmds: Cmd[] = [
    { id: "deploy", label: "Deploy a new service…", kbd: "D", section: "Actions" },
    { id: "rollback", label: "Rollback last deployment", kbd: "⇧ R", section: "Actions" },
    { id: "logs:api", label: "Tail logs · api", section: "Logs" },
    { id: "logs:web", label: "Tail logs · web", section: "Logs" },
    { id: "logs:worker", label: "Tail logs · worker", section: "Logs" },
    { id: "goto:graph", label: "Go to graph", kbd: "G G", section: "Navigate" },
    { id: "goto:deployments", label: "Go to deployments", kbd: "G D", section: "Navigate" },
    { id: "goto:env", label: "Go to variables", kbd: "G V", section: "Navigate" },
    { id: "goto:metrics", label: "Go to metrics", kbd: "G M", section: "Navigate" },
    { id: "env:prod", label: "Switch to production", section: "Environment" },
    { id: "env:staging", label: "Switch to staging", section: "Environment" },
    { id: "env:preview", label: "Switch to preview", section: "Environment" },
  ];

  const filtered = q ? cmds.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())) : cmds;
  const sections = [...new Set(filtered.map((c) => c.section))];

  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.32)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 100,
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxHeight: 480,
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "var(--shadow-lg)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <I.search width={14} height={14} style={{ color: "var(--fg-3)" }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a command or search…"
            style={{ flex: 1, border: 0, outline: "none", background: "transparent", fontSize: 14 }}
          />
          <span className="os-kbd">esc</span>
        </div>
        <div className="os-scroll" style={{ overflow: "auto", padding: 6 }}>
          {sections.map((sec) => (
            <div key={sec}>
              <div
                style={{
                  padding: "8px 10px 4px",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--fg-4)",
                }}
              >
                {sec}
              </div>
              {filtered
                .filter((c) => c.section === sec)
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      onAction(c.id);
                      onClose();
                    }}
                    className="row gap-3"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 6,
                      fontSize: 13,
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-overlay)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <span style={{ flex: 1 }}>{c.label}</span>
                    {c.kbd && <span className="os-kbd">{c.kbd}</span>}
                  </button>
                ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>No matches</div>
          )}
        </div>
      </div>
    </div>
  );
}
