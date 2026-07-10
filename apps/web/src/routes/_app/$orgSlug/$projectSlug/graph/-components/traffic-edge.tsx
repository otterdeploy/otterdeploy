/**
 * Route → service edge. Renders the same smoothstep geometry as the default
 * edges; when the route is carrying traffic the edge object arrives already
 * decorated (animated / widened — see route-traffic.ts) and this component
 * adds the "N rps · p95 Xms" label on hover or selection. Quiet edges render
 * plain and label-free — no invented numbers.
 */

import { useState } from "react";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

import type { TrafficEdgeData } from "./route-traffic";

import { formatRps } from "./route-traffic";

export function TrafficEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  selected,
  data,
}: EdgeProps<Edge<TrafficEdgeData>>) {
  const [hovered, setHovered] = useState(false);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const rps = data?.rps;
  const showLabel = (hovered || selected) && typeof rps === "number" && rps > 0;

  return (
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {showLabel ? (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute z-10 rounded-md border bg-card px-2 py-0.5 font-mono text-[10.5px] whitespace-nowrap text-foreground/80 shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {formatRps(rps)} rps · p95 {Math.round(data?.p95 ?? 0)}ms
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </g>
  );
}
