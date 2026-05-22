// Unified project workspace — Graph as the canvas, with a bottom drawer
// holding Stack code / Activity feed / Traffic table.
// Replaces the old variant=graph|stack|console split.

import { useEffect, useMemo, useRef, useState } from "react";

import { I } from "../icons";
import { EDGES, SERVICES } from "../data";
import type { Env } from "../data";

import { ServiceGraph } from "./service-graph";
import { STACK_TOML, CodeLine, ActivityFeed, EdgeRow } from "../components/workspace-helpers";

type Props = {
  env: Env;
  onOpenLogs: (id: string) => void;
  onDeploy: () => void;
  onOpenService: (id: string) => void;
  onNewService: () => void;
};

type DrawerTab = "stack" | "activity" | "traffic";

const STORAGE_KEY = "otterstack:workspace-drawer";
const MIN_DRAWER_PX = 160;
const MAX_DRAWER_FRAC = 0.7;
const DEFAULT_DRAWER_PX = 280;
const COLLAPSED_PX = 38;

type DrawerState = {
  open: boolean;
  tab: DrawerTab;
  height: number;
};

function readDrawerState(): DrawerState {
  if (typeof window === "undefined") return { open: true, tab: "stack", height: DEFAULT_DRAWER_PX };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { open: true, tab: "stack", height: DEFAULT_DRAWER_PX };
    const parsed = JSON.parse(raw) as Partial<DrawerState>;
    return {
      open: parsed.open ?? true,
      tab: (parsed.tab as DrawerTab) ?? "stack",
      height: parsed.height ?? DEFAULT_DRAWER_PX,
    };
  } catch {
    return { open: true, tab: "stack", height: DEFAULT_DRAWER_PX };
  }
}

export function ProjectWorkspace(props: Props) {
  const [state, setState] = useState<DrawerState>(readDrawerState);
  const [tick, setTick] = useState(0);

  // Persist drawer state
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  // Tick for ActivityFeed / sparklines
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1500);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        <ServiceGraph {...props} />
      </div>
      <BottomDrawer state={state} setState={setState} tick={tick} />
    </div>
  );
}

function BottomDrawer({
  state,
  setState,
  tick,
}: {
  state: DrawerState;
  setState: (next: DrawerState | ((prev: DrawerState) => DrawerState)) => void;
  tick: number;
}) {
  const drag = useRef<{ startY: number; startH: number } | null>(null);

  const setOpen = (open: boolean) => setState((s) => ({ ...s, open }));
  const setTab = (tab: DrawerTab) => setState((s) => ({ ...s, tab, open: true }));
  const setHeight = (h: number) =>
    setState((s) => ({
      ...s,
      height: Math.max(MIN_DRAWER_PX, Math.min(window.innerHeight * MAX_DRAWER_FRAC, h)),
    }));

  const onMouseDown = (e: React.MouseEvent) => {
    drag.current = { startY: e.clientY, startH: state.height };
    const onMove = (ev: MouseEvent) => {
      if (!drag.current) return;
      const dy = drag.current.startY - ev.clientY;
      setHeight(drag.current.startH + dy);
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const tabs: Array<{ id: DrawerTab; label: string; icon: keyof typeof I }> = [
    { id: "stack", label: "Stack code", icon: "doc" },
    { id: "activity", label: "Activity", icon: "log" },
    { id: "traffic", label: "Traffic", icon: "metrics" },
  ];

  const drawerHeight = state.open ? state.height : COLLAPSED_PX;

  return (
    <div
      style={{
        height: drawerHeight,
        flexShrink: 0,
        borderTop: "1px solid var(--border)",
        background: "var(--bg-elev)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
        transition: drag.current ? undefined : "height 140ms ease",
      }}
    >
      {/* drag handle */}
      {state.open && (
        <div
          onMouseDown={onMouseDown}
          style={{
            position: "absolute",
            top: -3,
            left: 0,
            right: 0,
            height: 6,
            cursor: "ns-resize",
            zIndex: 5,
          }}
        />
      )}

      {/* header / tab strip */}
      <div
        className="row"
        style={{
          height: COLLAPSED_PX,
          flexShrink: 0,
          padding: "0 8px 0 4px",
          borderBottom: state.open ? "1px solid var(--border)" : "none",
          background: "var(--bg-elev)",
        }}
      >
        {tabs.map((t) => {
          const Icon = I[t.icon];
          const active = state.open && state.tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => (active ? setOpen(false) : setTab(t.id))}
              className="row gap-2"
              style={{
                height: "100%",
                padding: "0 12px",
                fontSize: 12,
                color: active ? "var(--fg)" : "var(--fg-3)",
                fontWeight: active ? 500 : 400,
                background: active ? "var(--bg-overlay)" : "transparent",
                cursor: "pointer",
                position: "relative",
                border: 0,
              }}
            >
              <Icon width={12} height={12} style={{ opacity: 0.8 }} />
              <span>{t.label}</span>
              {active && (
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: -1,
                    height: 2,
                    background: "var(--fg)",
                  }}
                />
              )}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button
          className="btn ghost icon sm"
          title={state.open ? "Collapse" : "Expand"}
          onClick={() => setOpen(!state.open)}
          style={{ height: 22 }}
        >
          <I.chevDown
            width={12}
            height={12}
            style={{ transform: state.open ? "rotate(0deg)" : "rotate(180deg)" }}
          />
        </button>
      </div>

      {/* body */}
      {state.open && (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {state.tab === "stack" && <StackPane />}
          {state.tab === "activity" && <ActivityPane tick={tick} />}
          {state.tab === "traffic" && <TrafficPane tick={tick} />}
        </div>
      )}
    </div>
  );
}

function StackPane() {
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const [diff, setDiff] = useState(false);
  const toml = useMemo(() => STACK_TOML(SERVICES), []);
  const tomlLines = toml.split("\n");

  return (
    <>
      <div className="os-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg)" }}>
        {!diff ? (
          <div className="mono" style={{ fontSize: 12.5, lineHeight: 1.7, padding: "10px 0" }}>
            {tomlLines.map((line, i) => (
              <CodeLine
                key={i}
                num={i + 1}
                text={line}
                active={hoverLine === i}
                onHover={() => setHoverLine(i)}
                onLeave={() => setHoverLine(null)}
                onClick={() => undefined}
              />
            ))}
          </div>
        ) : (
          <div className="mono" style={{ padding: 16, fontSize: 12, color: "var(--fg-3)" }}>
            Diff vs production · only changed services would appear here.
          </div>
        )}
      </div>
      <div
        className="row gap-2"
        style={{
          padding: "8px 14px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg-elev)",
          flexShrink: 0,
        }}
      >
        <span className="badge mono" style={{ background: "var(--bg-sunken)" }}>
          helio.stack.toml
        </span>
        <div
          className="row gap-1"
          style={{
            background: "var(--bg-sunken)",
            padding: 2,
            borderRadius: 5,
            border: "1px solid var(--border)",
          }}
        >
          <button
            onClick={() => setDiff(false)}
            className="mono"
            style={{
              padding: "3px 8px",
              fontSize: 11,
              borderRadius: 3,
              background: !diff ? "var(--bg-elev)" : "transparent",
              color: !diff ? "var(--fg)" : "var(--fg-3)",
              cursor: "pointer",
              boxShadow: !diff ? "var(--shadow-sm)" : "none",
            }}
          >
            edit
          </button>
          <button
            onClick={() => setDiff(true)}
            className="mono"
            style={{
              padding: "3px 8px",
              fontSize: 11,
              borderRadius: 3,
              background: diff ? "var(--bg-elev)" : "transparent",
              color: diff ? "var(--fg)" : "var(--fg-3)",
              cursor: "pointer",
              boxShadow: diff ? "var(--shadow-sm)" : "none",
            }}
          >
            diff vs prod
          </button>
        </div>
        <div style={{ flex: 1 }} />
        <span className="muted mono" style={{ fontSize: 11 }}>
          {tomlLines.length} lines
        </span>
        <button className="btn sm" disabled style={{ opacity: 0.5 }}>
          Discard
        </button>
        <button className="btn primary sm">
          <span className="mono" style={{ fontSize: 10 }}>
            ⌘S
          </span>{" "}
          Apply →
        </button>
      </div>
    </>
  );
}

function ActivityPane({ tick }: { tick: number }) {
  return (
    <div className="os-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px 12px" }}>
      <ActivityFeed tick={tick} />
    </div>
  );
}

function TrafficPane({ tick }: { tick: number }) {
  return (
    <div className="os-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <div
        className="row"
        style={{
          padding: "8px 14px",
          borderBottom: "1px solid var(--border)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--fg-3)",
          background: "var(--bg-sunken)",
        }}
      >
        <span style={{ width: 130 }}>From</span>
        <span style={{ width: 16 }} />
        <span style={{ width: 130 }}>To</span>
        <span style={{ width: 80 }}>Kind</span>
        <span style={{ flex: 1 }}>Throughput</span>
        <span style={{ width: 80, textAlign: "right" }}>RPS</span>
        <span style={{ width: 80, textAlign: "right" }}>p95</span>
        <span style={{ width: 80, textAlign: "right" }}>Errors</span>
      </div>
      {EDGES.map((e, i) => (
        <EdgeRow key={i} e={e} idx={i} tick={tick} />
      ))}
    </div>
  );
}
