import { cx, Mono } from "../landing/primitives";

/** One resource in the preview graph: a rail dot + a node chip. */
function GraphNode({
  name,
  kind,
  tone,
}: {
  name: string;
  kind: string;
  tone: "service" | "branch";
}) {
  const branch = tone === "branch";
  return (
    <div className="relative flex items-center gap-3">
      <span
        className={cx(
          "relative z-10 size-2.5 shrink-0 rounded-full ring-4 ring-[#0c0d0e]",
          branch ? "bg-[#3d7bfb]" : "bg-[#3fb950]",
        )}
      />
      <div
        className={cx(
          "flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border px-3 py-2",
          branch ? "border-[#3d7bfb]/30 bg-[#3d7bfb]/[0.07]" : "border-white/[0.1] bg-[#0f1011]",
        )}
      >
        <span className="flex items-center gap-2 truncate">
          <Mono className={branch ? "text-[#7ab5ff]" : "text-white/85"}>{name}</Mono>
          {branch && (
            <span className="rounded border border-[#3d7bfb]/30 px-1 py-px font-mono text-[0.625rem] text-[#7ab5ff]">
              branch
            </span>
          )}
        </span>
        <span className="shrink-0 text-[0.6875rem] text-white/55">{kind}</span>
      </div>
    </div>
  );
}

export function PreviewGraph() {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-[#0c0d0e] p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
          maskImage: "radial-gradient(ellipse 80% 70% at 70% 30%, #000, transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 70% 30%, #000, transparent 78%)",
        }}
      />
      <div className="relative flex items-center justify-between">
        <h3 className="text-[0.9375rem] font-semibold text-white/90">Pull request preview</h3>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#3d7bfb]/30 bg-[#3d7bfb]/[0.08] px-2 py-0.5">
          <span aria-hidden className="size-1.5 rounded-full bg-[#3d7bfb]" />
          <Mono className="text-[#7ab5ff]">pr-482</Mono>
        </span>
      </div>

      <div className="relative mt-4">
        <span aria-hidden className="absolute top-3 bottom-3 left-[4.5px] w-px bg-white/[0.12]" />
        <div className="flex flex-col gap-2.5">
          <GraphNode name="web" kind="service · running" tone="service" />
          <GraphNode name="api" kind="service · running" tone="service" />
          <GraphNode name="postgres" kind="branched from production" tone="branch" />
        </div>
      </div>

      <p className="relative mt-auto pt-4 text-[0.8125rem] leading-relaxed text-pretty text-muted-foreground">
        The whole preview is one graph: services and a branched PostgreSQL database. The preview's{" "}
        <Mono className="text-foreground/70">{"${{db.DATABASE_URL}}"}</Mono> resolves to{" "}
        <span className="text-[#7ab5ff]">pr-482</span>, so preview writes stay isolated from the
        production database.
      </p>
    </div>
  );
}
