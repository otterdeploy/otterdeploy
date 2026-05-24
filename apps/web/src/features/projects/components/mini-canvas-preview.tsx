import { useId } from "react";

type Props = {
  databases: number;
  routes: number;
  className?: string;
};

const MAX_DATABASE_RECTS = 4;

export function MiniCanvasPreview({ databases, routes, className }: Props) {
  // Unique pattern id per instance so multiple previews on one page
  // (the project list grid) don't collide on `<defs>`.
  const reactId = useId();
  const dotPatternId = `mini-dots-${reactId}`;
  const visible = Math.min(databases, MAX_DATABASE_RECTS);
  const overflow = Math.max(0, databases - MAX_DATABASE_RECTS);
  const hasContent = databases > 0 || routes > 0;

  return (
    <svg
      viewBox="0 0 120 80"
      className={className}
      role="img"
      aria-label="Project canvas preview"
    >
      <defs>
        <pattern
          id={dotPatternId}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r="0.6" fill="currentColor" opacity="0.18" />
        </pattern>
      </defs>
      <rect
        width="120"
        height="80"
        fill={`url(#${dotPatternId})`}
        className="text-muted-foreground"
      />
      {!hasContent ? (
        <text
          x="60"
          y="44"
          textAnchor="middle"
          fontSize="9"
          fill="currentColor"
          className="text-muted-foreground"
        >
          empty
        </text>
      ) : (
        <>
          {Array.from({ length: visible }).map((_, i) => (
            <rect
              key={i}
              x={10 + i * 18}
              y={28}
              width={14}
              height={24}
              rx={3}
              fill="currentColor"
              className="text-foreground/70"
            />
          ))}
          {overflow > 0 ? (
            <text
              x={10 + visible * 18 + 4}
              y={42}
              fontSize="8"
              fill="currentColor"
              className="text-muted-foreground"
            >
              +{overflow}
            </text>
          ) : null}
          {routes > 0 ? (
            <circle
              cx={104}
              cy={16}
              r={5}
              fill="currentColor"
              className="text-amber-500"
            />
          ) : null}
        </>
      )}
    </svg>
  );
}
