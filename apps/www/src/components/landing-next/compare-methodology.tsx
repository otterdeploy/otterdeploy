import { GITHUB_URL } from "../landing/content";

const SOURCES = [
  ["Coolify", "https://coolify.io/docs"],
  ["Dokploy", "https://docs.dokploy.com"],
  ["CapRover", "https://caprover.com/docs/get-started.html"],
] as const;

export function CompareMethodology() {
  return (
    <p className="mt-5 text-[0.75rem] leading-relaxed text-muted-foreground">
      Based on the public docs for{" "}
      {SOURCES.map(([name, href], index) => (
        <span key={name}>
          {index > 0 && (index === SOURCES.length - 1 ? ", and " : ", ")}
          <a className="underline underline-offset-2 hover:text-foreground" href={href}>
            {name}
          </a>
        </span>
      ))}
      , checked September 3, 2026. “Partial” means extra setup or documented limits apply. A rollout
      mark describes the update mechanism, not a guarantee of uninterrupted requests: health checks
      and spare capacity still matter. Spotted a stale mark?{" "}
      <a
        className="underline underline-offset-2 hover:text-foreground"
        href={`${GITHUB_URL}/issues`}
      >
        Open an issue
      </a>{" "}
      and we’ll fix it.
    </p>
  );
}
