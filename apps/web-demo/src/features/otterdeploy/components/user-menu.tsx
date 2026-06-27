import { useEffect, useRef, useState } from "react";

import { USER } from "../data";
import { I } from "../icons";

interface Props {
  onSettings?: () => void;
  onSignOut?: () => void;
}

export function UserMenu({ onSettings, onSignOut }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="os-usermenu-trigger" onClick={() => setOpen((o) => !o)}>
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: 5,
            background: "var(--bg-overlay)",
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 600,
            color: "var(--fg)",
          }}
        >
          {USER.initials}
        </span>
        <span
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            alignItems: "flex-start",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.2 }}>{USER.name}</span>
          <span className="muted" style={{ fontSize: 10 }}>
            {USER.org}
          </span>
        </span>
        <I.chevDown width={12} height={12} style={{ marginLeft: "auto", color: "var(--fg-3)" }} />
      </button>
      {open ? (
        <div className="os-usermenu-pop" style={{ padding: 6 }}>
          <div style={{ padding: "8px 10px 6px" }}>
            <div style={{ fontSize: 11, fontWeight: 500 }}>{USER.email}</div>
            <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>
              role · {USER.role}
            </div>
          </div>
          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          <div className="os-side-label" style={{ padding: "4px 10px 2px" }}>
            Switch organization
          </div>
          {USER.orgs.map((o) => (
            <button key={o} className="os-usermenu-item">
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  background: "var(--bg-overlay)",
                  display: "grid",
                  placeItems: "center",
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  fontWeight: 600,
                }}
              >
                {o.slice(0, 1)}
              </span>
              <span style={{ flex: 1, textAlign: "left" }}>{o}</span>
              {o === USER.org ? (
                <I.check width={12} height={12} style={{ color: "var(--fg)" }} />
              ) : null}
            </button>
          ))}
          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          <button className="os-usermenu-item" onClick={onSettings}>
            <I.settings width={13} height={13} /> Account settings
          </button>
          <button className="os-usermenu-item">
            <I.users width={13} height={13} /> Invite team
          </button>
          <button className="os-usermenu-item">
            <I.doc width={13} height={13} /> Docs
          </button>
          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          <button className="os-usermenu-item" onClick={onSignOut}>
            <I.logout width={13} height={13} /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
