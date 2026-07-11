/**
 * Architecture diagram for a template's detail modal — generated entirely
 * from the parsed compose file (ports → exposed, depends_on → edges, named
 * volume mounts → volume nodes). Nothing here is hand-drawn per template, so
 * the diagram can never drift from the YAML that actually deploys.
 */
import type { ParsedCompose } from "@otterdeploy/api/stack/compose/types";

interface DiagramNode {
  id: string;
  label: string;
  kind: "internet" | "service" | "volume";
  x: number;
  y: number;
}

interface DiagramEdge {
  from: string;
  to: string;
}

const NODE_W = 124;
const NODE_H = 30;
const COL_GAP = 52;
const ROW_GAP = 12;
const PAD = 14;

interface Diagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  width: number;
  height: number;
}

export function buildDiagram(parsed: ParsedCompose): Diagram {
  const exposed = parsed.services.filter((s) => s.ports.length > 0);
  const internal = parsed.services.filter((s) => s.ports.length === 0);

  // Columns left→right: internet, exposed services, internal services, volumes.
  const columns: { id: string; label: string; kind: DiagramNode["kind"] }[][] = [];
  if (exposed.length > 0) {
    columns.push([{ id: "internet", label: "internet", kind: "internet" }]);
    columns.push(
      exposed.map((s) => ({ id: `svc:${s.name}`, label: s.name, kind: "service" as const })),
    );
  }
  if (internal.length > 0) {
    columns.push(
      internal.map((s) => ({ id: `svc:${s.name}`, label: s.name, kind: "service" as const })),
    );
  }
  if (parsed.volumeNames.length > 0) {
    columns.push(
      parsed.volumeNames.map((v) => ({ id: `vol:${v}`, label: v, kind: "volume" as const })),
    );
  }

  const maxRows = Math.max(1, ...columns.map((c) => c.length));
  const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP;
  const width = PAD * 2 + columns.length * NODE_W + (columns.length - 1) * COL_GAP;

  const nodes: DiagramNode[] = columns.flatMap((col, ci) => {
    // Center each column vertically against the tallest one.
    const colHeight = col.length * NODE_H + (col.length - 1) * ROW_GAP;
    const y0 = PAD + (height - PAD * 2 - colHeight) / 2;
    return col.map((n, ri) => ({
      ...n,
      x: PAD + ci * (NODE_W + COL_GAP),
      y: y0 + ri * (NODE_H + ROW_GAP),
    }));
  });

  const edges: DiagramEdge[] = [
    ...exposed.map((s) => ({ from: "internet", to: `svc:${s.name}` })),
    ...parsed.services.flatMap((s) =>
      s.dependsOn.map((d) => ({ from: `svc:${s.name}`, to: `svc:${d}` })),
    ),
    ...parsed.services.flatMap((s) =>
      s.volumes
        .filter((m) => m.type === "volume" && m.source)
        .map((m) => ({ from: `svc:${s.name}`, to: `vol:${m.source}` })),
    ),
  ];

  return { nodes, edges, width, height };
}

function edgePoints(a: DiagramNode, b: DiagramNode) {
  // Right edge of the left node → left edge of the right node.
  if (a.x <= b.x) {
    return { x1: a.x + NODE_W, y1: a.y + NODE_H / 2, x2: b.x - 3, y2: b.y + NODE_H / 2 };
  }
  return { x1: a.x, y1: a.y + NODE_H / 2, x2: b.x + NODE_W + 3, y2: b.y + NODE_H / 2 };
}

export function TemplateArchDiagram({ parsed }: { parsed: ParsedCompose }) {
  const { nodes, edges, width, height } = buildDiagram(parsed);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="overflow-x-auto rounded-lg bg-muted/40 p-3 ring-1 ring-foreground/10">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Architecture: ${parsed.services.map((s) => s.name).join(", ")}${
          parsed.volumeNames.length > 0 ? `; volumes: ${parsed.volumeNames.join(", ")}` : ""
        }`}
        className="block"
      >
        <defs>
          <marker
            id="tpl-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 z" className="fill-muted-foreground" />
          </marker>
        </defs>
        {edges.map((e) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          const p = edgePoints(a, b);
          return (
            <line
              key={`${e.from}→${e.to}`}
              {...p}
              className="stroke-muted-foreground/60"
              strokeWidth={1}
              strokeDasharray={b.kind === "volume" ? "3 3" : undefined}
              markerEnd="url(#tpl-arrow)"
            />
          );
        })}
        {nodes.map((n) => (
          <g key={n.id} transform={`translate(${n.x},${n.y})`}>
            <rect
              width={NODE_W}
              height={NODE_H}
              rx={6}
              className={n.kind === "internet" ? "fill-transparent" : "fill-card"}
              strokeWidth={1}
              strokeDasharray={n.kind === "internet" ? "3 3" : undefined}
              stroke="var(--border)"
            />
            <text
              x={NODE_W / 2}
              y={NODE_H / 2 + 3.5}
              textAnchor="middle"
              className={`font-mono text-[10px] ${
                n.kind === "service" ? "fill-foreground" : "fill-muted-foreground"
              }`}
            >
              {n.label.length > 17 ? `${n.label.slice(0, 16)}…` : n.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
