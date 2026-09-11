/**
 * A project's deploy history, shaped like a real one.
 *
 * The mix is the point, and it is a different mix from the log surfaces. A
 * deployments table is not a firehose: a busy project produces tens of rows a
 * day, not thousands an hour, so the window is a week and the histogram's bars
 * are DAYS with gaps between them — weekends, and the afternoon somebody shipped
 * eleven times trying to fix one thing.
 *
 * Most deploys succeed and are then superseded by the next one. That is the
 * ordinary life of a row here, and the fixture leans that way on purpose so the
 * failures and the two in-flight builds read as the exceptions they are rather
 * than as a decorative spread of every status.
 */

import type { DeploymentRow } from "@/features/deployments/table/deployment-cells";

import { outcomeOf } from "@/features/deployments/table/deployment-cells";
import { seededRandom, weightedPick } from "@/preview/fixtures/random";

interface Service {
  id: string;
  name: string;
  kind: "service" | "database" | "compose";
  env: string;
  /** Where its images come from — decides which provenance a row carries. */
  source: "git" | "image" | "upload";
  /** Roughly how often it ships, relative to the others. */
  weight: number;
  /** Typical build seconds. A Next.js app and a Postgres pull are not alike. */
  buildSeconds: number;
}

const SERVICES: Service[] = [
  {
    id: "svc_web",
    name: "web",
    kind: "service",
    env: "production",
    source: "git",
    weight: 30,
    buildSeconds: 165,
  },
  {
    id: "svc_api",
    name: "api",
    kind: "service",
    env: "production",
    source: "git",
    weight: 24,
    buildSeconds: 96,
  },
  {
    id: "svc_worker",
    name: "worker",
    kind: "service",
    env: "production",
    source: "git",
    weight: 14,
    buildSeconds: 88,
  },
  {
    id: "svc_web_stg",
    name: "web",
    kind: "service",
    env: "staging",
    source: "git",
    weight: 12,
    buildSeconds: 158,
  },
  {
    id: "svc_cli_edge",
    name: "edge-fn",
    kind: "service",
    env: "production",
    source: "upload",
    weight: 7,
    buildSeconds: 41,
  },
  {
    id: "svc_docs",
    name: "docs",
    kind: "service",
    env: "production",
    source: "git",
    weight: 6,
    buildSeconds: 52,
  },
  {
    id: "svc_pg",
    name: "postgres",
    kind: "database",
    env: "production",
    source: "image",
    weight: 4,
    buildSeconds: 12,
  },
  {
    id: "svc_stack",
    name: "analytics-stack",
    kind: "compose",
    env: "production",
    source: "image",
    weight: 3,
    buildSeconds: 19,
  },
];

/** Real-shaped commit subjects: the column exists so a person can recognise the
 *  deploy they are looking for, and "chore: update" cannot do that job. */
const COMMITS = [
  "fix(table): pinned actions column stops scrolling away",
  "feat(billing): usage-based line items on the invoice preview",
  "chore(deps): bump drizzle-orm to 0.44.7",
  "fix: don't retry a cancelled build",
  "perf(edge): reuse the h2c transport across upstream dials",
  "feat: passwordless sign-in by emailed code",
  'revert: "feat(logs): stream over websockets"',
  "fix(auth): session cookie survives a domain change",
  "docs: describe the deploy reason vocabulary",
  "refactor: one filter engine for the client and the WHERE clause",
  "fix(worker): drain the queue before shutting down",
  "feat(edge): per-route access controls",
];

/**
 * Commit authors, with and without an avatar.
 *
 * The avatars are inline SVG data URIs, not real URLs: a preview that reaches
 * out to github.com renders a column of broken images the moment it is opened
 * offline, which would be judging the network rather than the design. One
 * author is deliberately left without one so the fallback initial is on screen
 * beside the real thing.
 */
const AUTHORS: { name: string; avatar: string | null; weight: number }[] = [
  { name: "Jace", avatar: swatchAvatar("J", "#3d6fd1"), weight: 34 },
  { name: "Nadia Ortiz", avatar: swatchAvatar("N", "#0f8f88"), weight: 24 },
  { name: "Tomas Lindqvist", avatar: swatchAvatar("T", "#b4620a"), weight: 18 },
  { name: "priya-dev", avatar: swatchAvatar("P", "#7d4bd1"), weight: 15 },
  // The bot is a minority, as it is on a repo people actually work in. Drawn
  // uniformly it authored a third of the commits, including the feature ones,
  // which is both wrong and hides the avatars behind a wall of fallbacks.
  { name: "renovate[bot]", avatar: null, weight: 9 },
];

/** A flat circle with an initial, as a data URI. Enough to judge the column. */
function swatchAvatar(initial: string, fill: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${fill}"/><text x="16" y="22" font-family="sans-serif" font-size="17" fill="#fff" text-anchor="middle">${initial}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Build failures somebody has actually read at 2am. */
const ERRORS = [
  "step 7/14: npm ci exited 1 — ERESOLVE could not resolve peer react@^19",
  "context deadline exceeded after 900s: build timed out",
  "COPY failed: file not found in build context: ./dist",
  "no space left on device while writing layer sha256:9f1c…",
  "healthcheck never became ready: 30/30 probes failed on :3000/healthz",
];

const REASONS = [
  { reason: "git-push", weight: 52 },
  { reason: "redeploy", weight: 14 },
  { reason: "env-change", weight: 10 },
  { reason: "image-change", weight: 8 },
  { reason: "restart", weight: 6 },
  { reason: "rollback", weight: 5 },
  { reason: "create", weight: 3 },
] as const;

/**
 * How a settled deploy turned out.
 *
 * Roughly one in nine fails, which is what a project with CI in front of it
 * actually looks like. A perfect fixture makes the Error column look like dead
 * weight; a 50% failure rate makes the page look like a disaster.
 */
const SETTLED = [
  { status: "succeeded", weight: 82 },
  { status: "failed", weight: 11 },
  { status: "cancelled", weight: 4 },
  { status: "crashed", weight: 3 },
] as const;

function hex(random: () => number, length: number): string {
  let out = "";
  for (let index = 0; index < length; index++) {
    out += "0123456789abcdef"[Math.floor(random() * 16)];
  }
  return out;
}

/** Provenance for a service, by where its images come from. */
function provenance(service: Service, random: () => number, tag: string) {
  if (service.source === "git") {
    const author = weightedPick(AUTHORS, random);
    return {
      image: `registry.otterdeploy.dev/${service.name}:${tag}`,
      gitSha: hex(random, 40),
      gitRef: service.env === "staging" ? "refs/heads/next" : "refs/heads/main",
      gitCommitMessage: COMMITS[Math.floor(random() * COMMITS.length)],
      gitCommitAuthor: author.name,
      gitCommitAuthorAvatar: author.avatar,
      sourceSha: null,
    };
  }
  if (service.source === "upload") {
    return {
      image: `registry.otterdeploy.dev/${service.name}:${tag}`,
      gitSha: null,
      gitRef: null,
      gitCommitMessage: null,
      gitCommitAuthor: null,
      gitCommitAuthorAvatar: null,
      sourceSha: hex(random, 40),
    };
  }
  return {
    image: service.name === "postgres" ? "postgres:17.4-alpine" : `grafana/grafana:11.6.0`,
    gitSha: null,
    gitRef: null,
    gitCommitMessage: null,
    gitCommitAuthor: null,
    gitCommitAuthorAvatar: null,
    sourceSha: null,
  };
}

/**
 * Deploys skew toward NOW, not a uniform spread.
 *
 * The histogram over a week is the one chart on this page, and a flat one says
 * nothing. Raising a uniform draw to a power pulls rows toward the present, so
 * recent days carry more deploys than last Tuesday — which is what a project
 * under active work looks like.
 *
 * No jitter, and no lower clamp. The first version had both, and near zero the
 * ±0.03 jitter dwarfed the 0.002 floor: every draw in the bottom tenth landed
 * on the clamp, and eight unrelated rows came out stamped with the same second.
 * A power of a clean uniform needs neither.
 */
function arrivalOffset(random: () => number): number {
  return random() ** 1.6;
}

export function deploymentFixtures(count = 220, days = 7, seed = 41): DeploymentRow[] {
  const random = seededRandom(seed);
  const now = Date.now();
  const spanMs = days * 86_400_000;
  const rows: DeploymentRow[] = [];

  for (let index = 0; index < count; index++) {
    const service = weightedPick(SERVICES, random);
    const createdAt = now - arrivalOffset(random) * spanMs;
    // Build time varies by about a third either way; a fixed number reads as a
    // constant rather than as a measurement.
    const durationMs = Math.round(service.buildSeconds * (0.7 + random() * 0.7) * 1000);
    const settled = weightedPick(SETTLED, random).status;
    const failed = settled === "failed" || settled === "crashed";

    rows.push({
      id: `dpl_${index.toString().padStart(4, "0")}`,
      projectId: "prj_otterdeploy",
      resourceId: service.id,
      resourceName: service.name,
      resourceKind: service.kind,
      environmentName: service.env,
      reason: weightedPick(REASONS, random).reason,
      // Every row starts settled; the pass below promotes the newest per
      // service to whatever it actually is now.
      status: settled === "succeeded" ? "superseded" : settled,
      errorMessage: failed ? ERRORS[Math.floor(random() * ERRORS.length)] : null,
      isLatest: false,
      outcome: outcomeOf(settled === "succeeded" ? "superseded" : settled),
      durationMs,
      completedAt: new Date(createdAt + durationMs).toISOString(),
      createdAt: new Date(createdAt).toISOString(),
      updatedAt: new Date(createdAt + durationMs).toISOString(),
      ...provenance(service, random, hex(random, 7)),
    });
  }

  rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return promoteNewest(rows, now, 2);
}

/**
 * Make the newest row per service tell the truth about that service.
 *
 * Without this every row reads `superseded`, which is a table with no present
 * tense in it — no `current` markers, no live clock, and nothing for Cancel or
 * Roll back to attach to. A real project always has services whose newest
 * deploy is the one currently running, and during a working session one or two
 * mid-build.
 *
 * The in-flight rows are placed rather than rolled for: a build takes about two
 * minutes and the window is a week, so leaving it to chance means the preview
 * shows a live clock roughly never — and the live clock is one of the things
 * being judged.
 */
function promoteNewest(rows: DeploymentRow[], now: number, inFlight: number): DeploymentRow[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    if (seen.has(row.resourceId)) return row;
    seen.add(row.resourceId);

    if (seen.size <= inFlight) {
      // The newest one has barely started, the one under it is most of the way
      // through — a build queued behind a build, which is both the ordinary
      // shape of a busy afternoon and the only way `pending` and `building`
      // both appear on screen to be judged against each other.
      const fraction = seen.size === 1 ? 0.06 : 0.55;
      const elapsed = Math.round((row.durationMs ?? 90_000) * fraction);
      const startedAt = new Date(now - elapsed).toISOString();
      return {
        ...row,
        isLatest: true,
        status: elapsed < 15_000 ? "pending" : "building",
        outcome: "in flight",
        errorMessage: null,
        durationMs: null,
        completedAt: null,
        createdAt: startedAt,
        updatedAt: startedAt,
      };
    }
    // A newest row that failed stays failed — that service has nothing running,
    // which is exactly the state somebody opened this page to find.
    if (row.outcome === "failed") return { ...row, isLatest: true };
    if (row.outcome === "cancelled") return { ...row, isLatest: true };
    return { ...row, isLatest: true, status: "running", outcome: "succeeded" };
  });
}
