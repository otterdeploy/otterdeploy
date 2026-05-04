// Shared project-tag UI: filter strip + chip editor + chip badge.
// Used by Servers, Databases, and Networking screens.

import { useEffect, useRef, useState } from "react";

import { I } from "../icons";
import { PROJECTS, type ProjectRef } from "../data";

export const ALL_PROJECTS = "__all__";

export function projectById(id: string): ProjectRef | undefined {
  return PROJECTS.find((p) => p.id === id);
}

/** Items show up in the strip with their count under the current tag set. */
export function ProjectFilterStrip({
  active,
  onChange,
  counts,
}: {
  active: string;
  onChange: (id: string) => void;
  /** id → count of items currently matching that tag (omit "all" — derived). */
  counts: Record<string, number>;
}) {
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);
  const items: Array<{ id: string; label: string; color?: string; count: number }> = [
    { id: ALL_PROJECTS, label: "All projects", count: allCount },
    ...PROJECTS.map((p) => ({ id: p.id, label: p.name, color: p.color, count: counts[p.id] ?? 0 })),
  ];
  return (
    <div
      className="row gap-1"
      style={{
        background: "var(--bg-sunken)",
        padding: 3,
        borderRadius: 6,
        border: "1px solid var(--border)",
        display: "inline-flex",
      }}
    >
      {items.map((it) => {
        const isActive = active === it.id;
        const dim = it.id !== ALL_PROJECTS && it.count === 0;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              borderRadius: 4,
              background: isActive ? "var(--bg-elev)" : "transparent",
              color: isActive ? "var(--fg)" : dim ? "var(--fg-4)" : "var(--fg-3)",
              fontWeight: isActive ? 500 : 400,
              cursor: "pointer",
              boxShadow: isActive ? "var(--shadow-sm)" : "none",
              border: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {it.color && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: it.color,
                  opacity: dim ? 0.4 : 1,
                }}
              />
            )}
            <span>{it.label}</span>
            <span
              className="mono"
              style={{ fontSize: 10, color: dim ? "var(--fg-4)" : "var(--fg-3)" }}
            >
              {it.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Inline chip badge — used to label rows / cards with their project tags. */
export function ProjectTagBadge({ id, onRemove }: { id: string; onRemove?: () => void }) {
  const p = projectById(id);
  if (!p)
    return (
      <span className="badge mono" style={{ background: "var(--bg-overlay)", fontSize: 10 }}>
        {id}
      </span>
    );
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "1px 6px 1px 5px",
        fontSize: 10,
        borderRadius: 3,
        background: `color-mix(in srgb, ${p.color} 14%, transparent)`,
        color: p.color,
        border: `1px solid color-mix(in srgb, ${p.color} 28%, transparent)`,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: p.color }} />
      <span>{p.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 12,
            height: 12,
            background: "transparent",
            border: 0,
            color: "currentColor",
            cursor: "pointer",
            opacity: 0.7,
            padding: 0,
            marginLeft: 2,
          }}
        >
          <I.close width={9} height={9} />
        </button>
      )}
    </span>
  );
}

/** Compact chip list with an "+ add" picker. Edits a string[] of project ids. */
export function ProjectTagChips({
  value,
  onChange,
  empty = "Any project",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** Caption shown when the array is empty. */
  empty?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

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

  const remaining = PROJECTS.filter((p) => !value.includes(p.id));

  return (
    <div ref={ref} className="row gap-1" style={{ flexWrap: "wrap", position: "relative" }}>
      {value.length === 0 && (
        <span className="muted" style={{ fontSize: 11 }}>
          {empty}
        </span>
      )}
      {value.map((id) => (
        <ProjectTagBadge key={id} id={id} onRemove={() => onChange(value.filter((v) => v !== id))} />
      ))}
      {remaining.length > 0 && (
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => setOpen((o) => !o)}
          style={{ height: 20, padding: "0 6px", fontSize: 11 }}
        >
          <I.plus width={9} height={9} /> tag
        </button>
      )}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 4,
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 4,
            zIndex: 100,
            boxShadow: "var(--shadow-md)",
            minWidth: 160,
          }}
        >
          <div
            className="muted"
            style={{
              padding: "6px 8px 4px",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Add project tag
          </div>
          {remaining.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onChange([...value, p.id]);
                setOpen(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "6px 8px",
                background: "transparent",
                border: 0,
                fontSize: 12,
                cursor: "pointer",
                borderRadius: 4,
                color: "var(--fg-2)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-overlay)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.color }} />
              <span className="mono">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Filter helper: returns true if any of the resource's project tags includes the active tag.
 * Empty tags = "general pool" → matches every project filter. */
export function matchesProjectFilter(active: string, tags: string[] | undefined): boolean {
  if (active === ALL_PROJECTS) return true;
  if (!tags || tags.length === 0) return true; // general pool
  return tags.includes(active);
}
