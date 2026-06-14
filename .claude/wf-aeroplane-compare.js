export const meta = {
  name: 'aeroplane-compare',
  description: 'Compare otterstack vs vendored aeroplane competitor across all subsystems; verify claims against real files; synthesize a cited report',
  phases: [
    { title: 'Compare' },
    { title: 'Verify' },
    { title: 'Context' },
    { title: 'Synthesize' },
  ],
}

// Both codebases are local. OUR code = apps/* + packages/*. THEIR code = research/aeroplane/src/*.
const PREAMBLE = `You are comparing TWO self-hosted deployment-platform codebases that both build with Railpack and route with Caddy.

OURS ("otterstack"/"otterdeploy"): a Bun monorepo. Backend logic lives in packages/api/src (oRPC routers + subsystem dirs), packages/jobs (BullMQ workers), packages/db (Postgres+Drizzle), packages/auth (better-auth + orgs/RBAC). Build worker is apps/builder/src. Edge/control-plane HTTP handlers are apps/server/src. Frontend is apps/web/src (TanStack Router + shadcn/Base UI). CLI is apps/cli.

THEIRS ("aeroplane", github.com/xt42io/aeroplane): a single Node/Hono app under research/aeroplane/src. Server logic is research/aeroplane/src/server/*.ts (flat files). Storage is SQLite via better-sqlite3 (research/aeroplane/src/server/schema.ts, db.ts). Frontend is research/aeroplane/src/client. It is single-tenant (one owner, no orgs).

Read the ACTUAL files on both sides before making any claim. Every claim MUST cite specific files (path, and the side: ours/theirs). Do not speculate about capabilities you did not see in code. If one side lacks a capability entirely, say so explicitly and note you searched. Be concrete and technical, not marketing-flavored. Working directory is the repo root.`

const DIMENSION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'ourApproach', 'theirApproach', 'weDoBetter', 'theyDoBetter', 'learnings'],
  properties: {
    dimension: { type: 'string' },
    ourApproach: { type: 'string', description: '3-6 sentences, cite our files' },
    theirApproach: { type: 'string', description: '3-6 sentences, cite their files' },
    parity: { type: 'array', items: { type: 'string' }, description: 'things roughly equal' },
    weDoBetter: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['point', 'evidence', 'severity'],
        properties: {
          point: { type: 'string' },
          evidence: { type: 'string', description: 'specific files on both sides proving this' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    theyDoBetter: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['point', 'evidence', 'severity'],
        properties: {
          point: { type: 'string' },
          evidence: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    learnings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['recommendation', 'rationale', 'effort'],
        properties: {
          recommendation: { type: 'string' },
          rationale: { type: 'string' },
          effort: { type: 'string', enum: ['small', 'medium', 'large'] },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reason'],
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'refuted', 'adjusted'] },
    reason: { type: 'string', description: 'cite the files you actually opened' },
    corrected: { type: 'string', description: 'if adjusted, the corrected claim' },
  },
}

const DIMENSIONS = [
  {
    key: 'architecture',
    prompt: `DIMENSION: Overall architecture, stack & multi-tenancy.
OURS: monorepo layout (apps/*, packages/*), Postgres+Drizzle (packages/db/src/schema/*), BullMQ job queue (packages/jobs/src), oRPC API (packages/api/src/routers/index.ts + routers/*), better-auth with organizations/RBAC (packages/auth/src, packages/api/src/routers/organization, packages/api/src/authz/membership.ts). Separate build worker process (apps/builder).
THEIRS: single Hono process (research/aeroplane/src/server/index.ts), SQLite via better-sqlite3 (research/aeroplane/src/server/db.ts, schema.ts), no separate worker, single-owner (research/aeroplane/src/server/auth.ts, user-management.ts, user-settings.ts).
Compare: data store choice (Postgres vs SQLite) and its consequences, process model (worker vs inline), multi-tenancy/orgs vs single-tenant, API style (oRPC contracts vs Hono routes), deployability/ops complexity. Who is simpler to self-host? Who scales further?`,
  },
  {
    key: 'build-pipeline',
    prompt: `DIMENSION: Build pipeline — Railpack, framework detection, image building.
OURS: apps/builder/src/{pipeline.ts,railpack.ts,detect-framework.ts,build-one.ts,clone.ts,docker-push.ts,run-process.ts,log-stream.ts,handler.ts}. Note our memory: monorepo subdir services build from repo ROOT; static sites use Railpack Caddy image + registry.
THEIRS: research/aeroplane/src/server/{buildkit.ts,dockerfile-build.ts,railpack-build-env.ts,frameworks.ts,framework-file-detectors.ts,framework-icon-catalog.ts,framework-icons.ts,deploy.ts}.
Compare: how each invokes Railpack, BuildKit usage (they use BuildKit directly on 127.0.0.1:1234 — do we?), Dockerfile support, framework detection breadth/accuracy, build env handling, registry/push model, build log streaming, monorepo handling, static-site handling. Who has the more robust/complete build path?`,
  },
  {
    key: 'deploy-runtime',
    prompt: `DIMENSION: Deploy execution & runtime orchestration (container lifecycle, zero-downtime, internal networking, ports).
OURS: packages/jobs/src/jobs/deploy.ts, packages/api/src/docker/*, packages/api/src/routers/deployment/*, packages/api/src/routers/docker/*.
THEIRS: research/aeroplane/src/server/{deploy.ts,runtime-network.ts,runtime-port.ts,service-runtime.ts (shared)}, research/aeroplane/src/shared/service-runtime.ts. README claims "zero-downtime container swaps".
Compare: zero-downtime deploy strategy, container swap/rollback, internal Docker networking, port allocation, health checks, multi-node vs single-node. Who orchestrates runtime more robustly?`,
  },
  {
    key: 'networking-edge',
    prompt: `DIMENSION: Edge, networking, domains, DNS automation, TLS certs.
OURS: packages/api/src/caddy/{reconciler.ts,builder.ts,client.ts,queries.ts}, packages/api/src/lib/{domains.ts,dns-resolver.ts,dns-verify.ts,domain-reachability.ts,cloudflare.ts,cloudflare-ips.ts,server-ip.ts}, packages/api/src/routers/caddy, proxy-route schema (multi-domain; ADD-AND-GO; custom Caddy config per project/route).
THEIRS: research/aeroplane/src/server/{caddy.ts,caddy-certificates.ts,service-domains.ts,root-domain.ts,dns-providers.ts,railway-custom-domains.ts}, plus assets/dns-providers.
Compare: Caddyfile vs Caddy JSON API reconciliation, multi-domain per service, wildcard/generated domains, custom-domain UX, DNS PROVIDER automation (they have dns-providers — do we?), cert handling, custom user config injection, validate-before-apply. Who has better networking?`,
  },
  {
    key: 'access-control',
    prompt: `DIMENSION: Access control, public-facing deployment protection, auth wall, firewall, API keys.
OURS: apps/server/src/handlers/deploy-protection.tsx, packages/api/src/authz/{guests.ts,otp.ts,tokens.ts,nonce.ts,membership.ts}, packages/api/src/routers/firewall, packages/api/src/routers/apiKeys, apps/web/src/features/api-keys. We have a Vercel-style auth wall (Caddy forward_auth + better-auth), guest email-OTP access, CrowdSec firewall.
THEIRS: research/aeroplane/src/server/{api-access-control.ts,api-keys.ts,api-key-routes.ts,auth.ts}.
Compare: scoped API keys (both?), public deployment-protection/auth-wall (do they have ANY equivalent of protecting deployed apps behind auth? search their code), bot/IP firewall, guest access. Who protects deployed apps better, and who has better programmatic API auth?`,
  },
  {
    key: 'database-tooling',
    prompt: `DIMENSION: Managed database services & data tooling (this is likely THEIR strongest area).
OURS: packages/api/src/routers/database (read API: query/tables via psql --csv, read-only; write path TODO), packages/api/src/docker/postgres.ts, packages/api/src/backups/* (engine/exec/scheduler/storage). Memory: data viewer is read-only; backups ship via docker-exec.
THEIRS: research/aeroplane/src/server/database-* (MANY): database-engine, database-console, database-data-imports, database-mongo-viewer, database-redis-viewer, database-runtime(+status), database-restore, database-backups, database-service-linker, database-source-image, database-urls, database-volume-adoption, database-viewer-shared; postgres-logical-replication, postgres-data-import, postgres-tls; redis-data-import, redis-persistence; backup-storage-routes, r2-storage. Frontend uses CodeMirror SQL console.
Compare HONESTLY and in depth: supported engines (pg/redis/mongo), data browsing/editing, SQL console, imports/migration into managed DBs, logical replication, TLS, volume adoption, backup targets (R2). This is where to be candid about gaps.`,
  },
  {
    key: 'observability',
    prompt: `DIMENSION: Observability — service/build logs, edge access logs, metrics, notifications, tracing.
OURS: packages/api/src/edge-logs/* (ring + Postgres partitions + geo + persist + query), packages/api/src/metrics/* (30s sampler + query), packages/api/src/notifications + packages/jobs/src/delivery/* (Slack/Discord/email/webhook/telegram/pagerduty + subscription matrix), packages/api/src/routers/{metrics,edge-logs,notifications}, apps/web features {logs,edge-logs,notifications}, OTel (apps/server/src/lib/tracing.ts). Streaming via oRPC event-iterators.
THEIRS: research/aeroplane/src/server/{logBus.ts,project-activity.ts}. Search for any metrics/notifications/edge-log equivalent.
Compare: log streaming, edge/access logs, resource metrics, alert/notification channels, tracing. Who gives operators more visibility? (Likely us — verify the gap on their side honestly.)`,
  },
  {
    key: 'env-secrets',
    prompt: `DIMENSION: Environment variables & secrets management.
OURS: packages/api/src/lib/variables/*, packages/api/src/routers/env. Memory (Dokploy-style): three-tier cascade + \${{scope.KEY}} references, plaintext at rest.
THEIRS: research/aeroplane/src/server/{variable-resolver.ts,secret-crypto.ts,env-file.ts,env-example-suggestions.ts}.
Compare: variable scoping/cascade, cross-reference interpolation, encryption at rest (they have secret-crypto — do we encrypt? we store plaintext per memory), .env import/export, AI-assisted env suggestions (env-example-suggestions). Who handles secrets more safely & ergonomically? Note honestly if they encrypt at rest and we don't.`,
  },
  {
    key: 'ai-features',
    prompt: `DIMENSION: AI-powered features.
OURS: search the repo for vercel-ai / @ai-sdk usage (grep "ai-sdk", "generateText", "streamText" across apps/ and packages/). Document what AI features we actually ship (may be little/none).
THEIRS: research/aeroplane/src/server/deployment-failure-ai.ts, env-example-suggestions.ts, research/aeroplane/src/shared/ai-providers.ts, research/aeroplane/src/client/features/services/deployment-failure-* (explanation modal, model picker, command), research/aeroplane/src/client/features/onboarding/onboarding-thread.tsx. They bundle 8 @ai-sdk providers (anthropic/openai/google/groq/mistral/xai/deepseek/openai-compatible).
Compare: AI deploy-failure diagnosis, AI env suggestions, conversational onboarding, multi-provider/model picker, BYO-key. This is likely a THEY-do-better area — quantify it and extract what's worth copying.`,
  },
  {
    key: 'migration-lifecycle',
    prompt: `DIMENSION: Migration/import, onboarding, and instance self-management.
OURS: apps/web/src/routes/onboarding, apps/web/src/features/git-providers, apps/web/src/features/registries, packages/api/src/git/* (GitHub app install/webhook/push). Search for any Railway-import or self-update equivalent (likely none).
THEIRS: research/aeroplane/src/server/{railway-importer.ts,railway-graphql.ts,railway-import-automation.ts,railway-custom-domains.ts,migration-bundle.ts,migration-crypto.ts,system-updates.ts,system-maintenance.ts,system-settings.ts,system.ts,github-connect.ts,github.ts}, client features/integrations/railway-import-modal.tsx + features/onboarding/* (conversational thread, migration-import-modal). README: installer self-clones + git-based self-update.
Compare: Railway migration (a real acquisition funnel for them), instance-to-instance migration bundles, self-update mechanism, onboarding flow, GitHub connect. Who has the better adoption/lifecycle story? Extract what's worth copying.`,
  },
  {
    key: 'frontend-ux',
    prompt: `DIMENSION: Frontend architecture & UX.
OURS: apps/web/src (TanStack Router, shadcn/Base UI per memory base-ui-select-needs-items, design system in DESIGN.md/PRODUCT.md, project graph view in features/projects/components/graph). i18n package. Features: projects, resources, servers, team, logs, edge-logs, notifications, api-keys, registries, terminal.
THEIRS: research/aeroplane/src/client (TanStack Router, Tailwind v4, HugeIcons, CodeMirror, react 19). Features: projects (service-cluster, setup-todo-list, system-health-pill), services (deployments/domains/variables/logs panels), onboarding (conversational thread), integrations.
Compare: routing/state approach, component library, design polish/system, project visualization (our graph vs their service-cluster), onboarding UX, in-app code editing (CodeMirror). Be fair about polish and information architecture.`,
  },
  {
    key: 'api-cli',
    prompt: `DIMENSION: Programmatic surface — public API & CLI.
OURS: oRPC contracts (packages/api/src/routers/*, served by apps/server), apps/cli (the "otterdeploy" end-user CLI — list apps/cli/src/commands), API keys feature.
THEIRS: research/aeroplane/src/server/{api-key-routes.ts,api-access-control.ts,api-keys.ts}. Search whether they ship a CLI at all (check research/aeroplane root + scripts).
Compare: typed API contracts vs REST, scoped key permissions, end-user CLI presence/coverage, OpenAPI/docs (we serve a spec; do they?). Who offers the better automation surface?`,
  },
]

phase('Compare')
log(`Comparing ${DIMENSIONS.length} subsystems across both codebases...`)

const compared = await pipeline(
  DIMENSIONS,
  (d) =>
    agent(`${PREAMBLE}\n\n${d.prompt}\n\nReturn the structured comparison. Keep weDoBetter/theyDoBetter to your most defensible points (each must cite real files on both sides). Mark severity by how much it matters to operators/users.`, {
      label: `compare:${d.key}`,
      phase: 'Compare',
      schema: DIMENSION_SCHEMA,
    }),
  // Stage 2: adversarially verify the high/medium better-claims against the actual files.
  (cmp, d) => {
    if (!cmp) return null
    const claims = [
      ...(cmp.weDoBetter || []).map((c) => ({ ...c, side: 'ours-better' })),
      ...(cmp.theyDoBetter || []).map((c) => ({ ...c, side: 'theirs-better' })),
    ].filter((c) => c.severity === 'high' || c.severity === 'medium')
    if (!claims.length) return { ...cmp, verifiedClaims: [] }
    return parallel(
      claims.map((c) => () =>
        agent(`${PREAMBLE}\n\nA comparison agent claimed (dimension: ${cmp.dimension}, direction: ${c.side}):\n"${c.point}"\nCited evidence: ${c.evidence}\n\nYour job: be a SKEPTIC. Open the cited files on BOTH sides and check. Is the claim accurate? Does the capability actually exist (or actually NOT exist) where claimed? If the comparison is wrong or overstated, refute or adjust it. Default to 'refuted' if you cannot find supporting code. Cite the files you opened.`, {
          label: `verify:${d.key}`,
          phase: 'Verify',
          schema: VERDICT_SCHEMA,
        }).then((v) => ({ claim: c, verdict: v })),
      ),
    ).then((verdicts) => ({ ...cmp, verifiedClaims: verdicts.filter(Boolean) }))
  },
)

// Hybrid web-context layer: ground "what to learn" in industry norms (both emulate Railway).
phase('Context')
const webContext = await parallel([
  () =>
    agent(`Web research. Both codebases emulate Railway's workflow. Research Railway's actual product model: how Railpack works, BuildKit-based builds, services/databases UX, environments, variables, and what made Railway's DX notable. Use WebSearch + WebFetch. Return ~8 concise, sourced bullet points (include URLs) on Railway/Railpack design decisions a self-hosted clone should care about.`, {
      label: 'web:railway-railpack',
      phase: 'Context',
    }),
  () =>
    agent(`Web research. What are current best practices and common pitfalls for self-hosted PaaS / deployment control planes (think Coolify, Dokploy, CapRover, Dokku, Kamal)? Focus on: zero-downtime deploys, secrets-at-rest, single-node vs multi-node scaling, SQLite vs Postgres for the control plane, and operator UX. Use WebSearch + WebFetch. Return ~8 concise, sourced bullets with URLs.`, {
      label: 'web:paas-bestpractice',
      phase: 'Context',
    }),
])

phase('Synthesize')
const payload = {
  comparisons: compared.filter(Boolean),
  webContext: webContext.filter(Boolean),
}

const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['executiveSummary', 'weDoBetter', 'theyDoBetter', 'topLearnings', 'verdict'],
  properties: {
    executiveSummary: { type: 'string', description: '1 tight paragraph' },
    positioning: { type: 'string', description: 'how the two products differ in intent/audience' },
    weDoBetter: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'dimension'],
        properties: { title: { type: 'string' }, detail: { type: 'string' }, dimension: { type: 'string' } },
      },
    },
    theyDoBetter: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'dimension'],
        properties: { title: { type: 'string' }, detail: { type: 'string' }, dimension: { type: 'string' } },
      },
    },
    topLearnings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['recommendation', 'why', 'effort', 'priority'],
        properties: {
          recommendation: { type: 'string' },
          why: { type: 'string' },
          effort: { type: 'string', enum: ['small', 'medium', 'large'] },
          priority: { type: 'string', enum: ['now', 'next', 'later'] },
        },
      },
    },
    verdict: { type: 'string', description: '2-3 sentences: net standing and the single most important move' },
  },
}

const report = await agent(
  `You are the lead synthesizer. Below is verified per-dimension comparison data between OUR platform (otterstack) and the AEROPLANE competitor, plus web context on Railway/PaaS norms.

Rules:
- Only use claims whose verdict is 'confirmed' or 'adjusted' (use the corrected text for adjusted). DROP 'refuted' claims entirely.
- Weight by severity and how much it affects real operators/users.
- "weDoBetter" and "theyDoBetter" should each be the strongest 5-9 items, deduped across dimensions, each naming the dimension.
- "topLearnings" = the highest-leverage things to copy/learn from aeroplane's decisions, prioritized (now/next/later) with effort. Ground rationale in both the code comparison and the web context where relevant.
- Be honest and specific. This is for the founder/engineer, not marketing.

DATA:\n${JSON.stringify(payload).slice(0, 180000)}`,
  { label: 'synthesize', phase: 'Synthesize', schema: REPORT_SCHEMA },
)

return { report, rawComparisons: compared.filter(Boolean), webContext: webContext.filter(Boolean) }
