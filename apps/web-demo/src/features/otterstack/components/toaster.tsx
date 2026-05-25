export type ToastKind = "ok" | "warn" | "err" | "info";
export interface Toast { id: number; msg: string; kind: ToastKind }

interface Props { toasts: Toast[]; dismiss: (id: number) => void }

const kindColor: Record<ToastKind, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  err: "var(--err)",
  info: "var(--info)",
};

export function Toaster({ toasts, dismiss }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        right: 16,
        bottom: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 200,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          style={{
            pointerEvents: "auto",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "var(--shadow-md)",
            fontSize: 12,
            color: "var(--fg)",
            cursor: "pointer",
            animation: "tIn 180ms ease-out",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: kindColor[t.kind] }} />
          <span>{t.msg}</span>
        </button>
      ))}
      <style>{`@keyframes tIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}
