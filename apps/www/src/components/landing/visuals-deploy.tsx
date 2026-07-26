import { Mono, StateChip, VisualFrame } from "./primitives";

/**
 * Showcase visuals, part one: the build and the project canvas.
 *
 * These are drawn in HTML rather than shipped as screenshots — they stay sharp
 * at any density, theme themselves from the same tokens as the dashboard, and
 * can't go stale the way a PNG of a UI does. They are illustrations of real
 * surfaces, not live data, so every value in them is either a state word the
 * product actually uses or an obvious placeholder (example.com).
 */

// ── Build log ──────────────────────────────────────────────────────────────

const BUILD_STEPS: { step: string; detail: string; time: string }[] = [
  { step: "detect", detail: "railpack · bun + vite", time: "0.4s" },
  { step: "install", detail: "412 packages", time: "6.2s" },
  { step: "build", detail: "bun run build", time: "11.4s" },
  { step: "image", detail: "sha256:9f3c1a…", time: "2.1s" },
  { step: "rollout", detail: "1/1 replicas healthy", time: "3.0s" },
];

function Tick() {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 16 16"
      className="mt-[3px] shrink-0 fill-none stroke-success"
    >
      <path d="M3 8.5l3.2 3.2L13 4.8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BuildVisual() {
  return (
    <VisualFrame
      title="storefront / web · build #128"
      trailing={<StateChip tone="success">running</StateChip>}
      bodyClassName="p-0"
    >
      <ul className="divide-y divide-border">
        {BUILD_STEPS.map((row) => (
          <li key={row.step} className="flex items-baseline gap-3 px-4 py-2.5">
            <Tick />
            <Mono className="w-[4.5rem] shrink-0 text-foreground">{row.step}</Mono>
            <span className="min-w-0 flex-1 truncate font-mono text-[0.75rem] text-muted-foreground">
              {row.detail}
            </span>
            <Mono className="shrink-0 text-muted-foreground">{row.time}</Mono>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t border-border bg-background px-4 py-2.5">
        <Mono className="text-foreground">deployed in 23.1s</Mono>
        <Mono className="text-muted-foreground">no downtime</Mono>
      </div>
    </VisualFrame>
  );
}
