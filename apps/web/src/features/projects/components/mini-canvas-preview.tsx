import { useId } from "react";

interface Props {
  services: number;
  databases: number;
  routes: number;
  className?: string;
}

const MAX_RESOURCE_RECTS = 4;

export function MiniCanvasPreview({ services, databases, routes, className }: Props) {
  // Unique pattern id per instance so multiple previews on one page
  // (the project list grid) don't collide on `<defs>`.
  const reactId = useId();
  const dotPatternId = `mini-dots-${reactId}`;
  // A project's resources are services AND databases — the thumbnail used to
  // only draw a rect per database, so a project with 2 services + 0-1
  // databases rendered as an almost-empty box. Draw one node per resource
  // (services first, then databases) up to the cap.
  const resourceCount = services + databases;
  const visibleServices = Math.min(services, MAX_RESOURCE_RECTS);
  const visibleDatabases = Math.min(databases, Math.max(0, MAX_RESOURCE_RECTS - visibleServices));
  const overflow = Math.max(0, resourceCount - MAX_RESOURCE_RECTS);
  const hasContent = resourceCount > 0 || routes > 0;

  return (
    <svg viewBox="0 0 120 80" className={className} role="img" aria-label="Project canvas preview">
      <defs>
        <pattern id={dotPatternId} width="6" height="6" patternUnits="userSpaceOnUse">
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
          {Array.from({ length: visibleServices }).map((_, i) => (
            <rect
              key={`svc-${i}`}
              x={10 + i * 18}
              y={28}
              width={14}
              height={24}
              rx={3}
              fill="currentColor"
              className="text-foreground/70"
            />
          ))}
          {Array.from({ length: visibleDatabases }).map((_, i) => (
            <rect
              key={`db-${i}`}
              x={10 + (visibleServices + i) * 18}
              y={28}
              width={14}
              height={24}
              rx={3}
              fill="currentColor"
              className="text-foreground/40"
            />
          ))}
          {overflow > 0 ? (
            <text
              x={10 + (visibleServices + visibleDatabases) * 18 + 4}
              y={42}
              fontSize="8"
              fill="currentColor"
              className="text-muted-foreground"
            >
              +{overflow}
            </text>
          ) : null}
          {routes > 0 ? (
            <circle cx={104} cy={16} r={5} fill="currentColor" className="text-amber-500" />
          ) : null}
        </>
      )}
    </svg>
  );
}
