import { cx, Mono, StateChip, VisualFrame } from "./primitives";

/**
 * Showcase visuals, part two: routes, environment resolution, and previews.
 * Same rules as visuals-deploy.tsx — HTML rather than screenshots, and every
 * state word is one the product really uses.
 */

// ── Routes ─────────────────────────────────────────────────────────────────

const ROUTES: { domain: string; upstream: string; cert: "valid" | "obtaining"; dns: string }[] = [
  { domain: "storefront.example.com", upstream: "web", cert: "valid", dns: "pointed" },
  { domain: "api.example.com", upstream: "api", cert: "valid", dns: "pointed" },
  { domain: "new.example.com", upstream: "web", cert: "obtaining", dns: "unpointed" },
];

function CertMark({ state }: { state: "valid" | "obtaining" }) {
  return state === "valid" ? (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 16 16"
      className="fill-none stroke-success"
    >
      <path
        d="M3 8.5l3.2 3.2L13 4.8"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 16 16"
      className="fill-none stroke-warning"
    >
      <circle cx="8" cy="8" r="5.5" strokeWidth="2" strokeDasharray="2.6 2.4" />
    </svg>
  );
}

export function RoutesVisual() {
  return (
    <VisualFrame
      title="edge / routes"
      trailing={<Mono className="text-muted-foreground">caddy</Mono>}
      bodyClassName="p-0"
    >
      <ul className="divide-y divide-border">
        {ROUTES.map((route) => (
          <li key={route.domain} className="px-4 py-3">
            <div className="flex items-center gap-2.5">
              <CertMark state={route.cert} />
              <Mono className="min-w-0 flex-1 truncate text-foreground">{route.domain}</Mono>
              <Mono className="shrink-0 text-muted-foreground">→ {route.upstream}</Mono>
            </div>
            <div className="mt-1.5 flex items-center gap-4 pl-[1.375rem]">
              <Mono className={cx(route.cert === "valid" ? "text-success" : "text-warning")}>
                tls {route.cert}
              </Mono>
              <Mono className="text-muted-foreground">dns {route.dns}</Mono>
            </div>
          </li>
        ))}
      </ul>
    </VisualFrame>
  );
}

// ── Environment resolution ─────────────────────────────────────────────────

export function EnvVisual() {
  return (
    <VisualFrame
      title="web · environment"
      trailing={<Mono className="text-muted-foreground">3 keys</Mono>}
      bodyClassName="p-0"
    >
      <ul className="divide-y divide-border">
        {[
          { key: "DATABASE_URL", value: "${database:postgres.DATABASE_URL}", tag: "" },
          { key: "REDIS_URL", value: "${database:cache.REDIS_URL}", tag: "" },
          { key: "STRIPE_KEY", value: "••••••••••••••••", tag: "sealed" },
        ].map((row) => (
          <li key={row.key} className="flex items-baseline gap-3 px-4 py-2.5">
            <Mono className="w-[7.5rem] shrink-0 truncate text-foreground">{row.key}</Mono>
            <span className="min-w-0 flex-1 truncate font-mono text-[0.75rem] text-muted-foreground">
              {row.value}
            </span>
            {row.tag ? (
              <Mono className="shrink-0 rounded border border-border px-1.5 text-muted-foreground">
                {row.tag}
              </Mono>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="border-t border-border bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <svg
            aria-hidden
            width="12"
            height="12"
            viewBox="0 0 16 16"
            className="shrink-0 fill-none stroke-muted-foreground"
          >
            <path
              d="M8 2.5v11M4.5 10L8 13.5 11.5 10"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <Mono className="text-muted-foreground">resolved at deploy</Mono>
        </div>
        <Mono className="mt-2 block truncate text-foreground">
          postgres://web:••••••@postgres:5432/app
        </Mono>
      </div>
    </VisualFrame>
  );
}

// ── PR preview ─────────────────────────────────────────────────────────────

export function PreviewVisual() {
  return (
    <VisualFrame
      title="pull request #482"
      trailing={<StateChip tone="info">preview · active</StateChip>}
      bodyClassName="p-0"
    >
      <div className="px-4 py-3.5">
        <p className="text-[0.875rem] font-medium">feat: checkout redesign</p>
        <Mono className="mt-1.5 block truncate text-foreground">storefront-pr-482.example.com</Mono>
      </div>

      <dl className="divide-y divide-border border-t border-border">
        {[
          { term: "compute", detail: "its own service, its own route" },
          { term: "database", detail: "postgres → branched copy" },
          { term: "teardown", detail: "when the PR closes, or when it goes idle" },
        ].map((row) => (
          <div key={row.term} className="flex items-baseline gap-3 px-4 py-2.5">
            <dt className="w-[5.5rem] shrink-0">
              <Mono className="text-muted-foreground">{row.term}</Mono>
            </dt>
            <dd className="min-w-0 flex-1 text-[0.8125rem] leading-snug text-foreground">
              {row.detail}
            </dd>
          </div>
        ))}
      </dl>
    </VisualFrame>
  );
}
