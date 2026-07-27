/**
 * The glyph vocabulary and the state → (glyph, colour) mapping.
 *
 * Two rules hold everywhere:
 *
 * 1. **Shape carries the meaning, colour reinforces it.** Every state gets a
 *    distinct glyph, so `NO_COLOR`, a pipe, or a colour-blind reader loses
 *    nothing. `●` vs `○` vs `◐` vs `✗` is legible in pure monochrome.
 *
 * 2. **Fill encodes liveness.** Filled means running, hollow means not yet,
 *    half-filled means in flight, a cross means it stopped badly, a middot
 *    means retired. That reads as one system across deployments, domains,
 *    backups, servers and resources rather than a per-command invention.
 *
 * Unlike bd, resource *kind* badges are deliberately uncoloured. DESIGN.md caps
 * the accent at ≤10% of a surface and specifies one accent hue, so hue is spent
 * on state — the thing a reader scans for — while kind stays a dim bracketed
 * word. Colouring five kinds would blow that budget and dilute the one signal.
 */

import type { Role } from "./theme";

import { dim, paint, strong } from "./theme";

// oxlint-disable-next-line node/no-process-env -- standalone CLI env boundary
const env = process.env;

/**
 * Box-drawing and geometric glyphs need a UTF-8 locale. Rather than probe the
 * terminal, trust the locale env vars and offer an explicit override — the
 * failure mode of guessing wrong is mojibake in every line of output.
 */
function unicodeEnabled(): boolean {
  if (env.OTTERDEPLOY_ASCII) return false;
  const locale = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG ?? "";
  // Windows Terminal and modern macOS/Linux all report UTF-8; an empty locale
  // on Windows still handles these code points, so only a non-UTF-8 locale
  // that was explicitly set falls back.
  if (locale === "") return process.platform === "win32";
  return /utf-?8/i.test(locale);
}

const UNICODE = unicodeEnabled();

function g(unicode: string, ascii: string): string {
  return UNICODE ? unicode : ascii;
}

/** The complete glyph set. Nothing outside this module invents a symbol. */
export const G = {
  /** Live and healthy. */
  live: g("●", "*"),
  /** Exists but not running — draft, pending, queued, unpointed. */
  idle: g("○", "o"),
  /** In flight — building, starting, obtaining, draining. */
  progress: g("◐", ">"),
  /** Stopped badly — failed, crashed, invalid, down. */
  failed: g("✗", "x"),
  /** Running but impaired — degraded, proxied. */
  degraded: g("△", "!"),
  /** Retired — superseded, removed, no-op. */
  retired: g("·", "."),

  // ── Structure ──────────────────────────────────────────────────────
  branch: g("├──", "|--"),
  lastBranch: g("└──", "`--"),
  vertical: g("│", "|"),
  /** Points at a parent (bd's `↑`). */
  parent: g("↑", "^"),
  /** Points back at what a row was derived from (bd's `←`). */
  derived: g("←", "<-"),
  /** Points at a next action — the one glyph that leads a hint. */
  next: g("→", "->"),
  /** Field separator inside a single line. */
  sep: g("·", "-"),

  // ── Diff marks ─────────────────────────────────────────────────────
  add: "+",
  remove: "-",
  change: "~",

  // ── Message prefixes ───────────────────────────────────────────────
  check: g("✓", "v"),
  cross: g("✗", "x"),
  bang: g("!", "!"),
  info: g("·", "-"),
} as const;

interface State {
  glyph: string;
  role: Role;
}

const LIVE: State = { glyph: G.live, role: "ok" };
const IDLE: State = { glyph: G.idle, role: "muted" };
const PROGRESS: State = { glyph: G.progress, role: "warn" };
const FAILED: State = { glyph: G.failed, role: "danger" };
const DEGRADED: State = { glyph: G.degraded, role: "warn" };
const RETIRED: State = { glyph: G.retired, role: "muted" };

/**
 * Every state string the API can hand the CLI, mapped to one presentation.
 *
 * Sourced from the DB enums so it cannot drift into fiction: deployment_status,
 * resource_status, proxy_route_dns_state, proxy_route_cert_state, backup_status,
 * backup_destination_status, server_status and project_status.
 */
const STATES: Record<string, State> = {
  // deployment_status (+ the API's derived `starting` / `crashed`)
  pending: IDLE,
  building: PROGRESS,
  starting: PROGRESS,
  running: LIVE,
  crashed: FAILED,
  failed: FAILED,
  superseded: RETIRED,
  removed: RETIRED,

  // resource_status / project_status
  draft: IDLE,
  valid: LIVE,
  invalid: FAILED,

  // proxy_route_dns_state
  pointed: LIVE,
  proxied: DEGRADED,
  unpointed: IDLE,
  unknown: IDLE,

  // proxy_route_cert_state — `valid` and `failed` are shared above
  obtaining: PROGRESS,

  // backup_status
  queued: IDLE,
  succeeded: LIVE,

  // backup_destination_status / webhook_status / preview_state
  active: LIVE,
  degraded: DEGRADED,
  paused: IDLE,
  closed: RETIRED,

  // server_status
  ready: LIVE,
  draining: PROGRESS,
  down: FAILED,

  // route status seen on service exposure
  enabled: LIVE,
  disabled: IDLE,

  // Phases the deploy wait-loop derives from runtime tasks rather than a
  // deployment row (see lib/wait.ts) — an image service never gets a row.
  scheduling: IDLE,
  error: FAILED,
  "not-scheduled": FAILED,
  timeout: FAILED,

  // audit_outcome. `denied` is deliberately DEGRADED rather than FAILED: a
  // policy refusal is the system working, not the system breaking, and reading
  // every denial as a failure trains people to ignore real ones.
  success: LIVE,
  failure: FAILED,
  denied: DEGRADED,
};

/** Presentation for a state string; unknown values degrade to a neutral dot. */
function stateOf(status: string): State {
  return STATES[status] ?? { glyph: G.retired, role: "muted" };
}

/** The leading state glyph for a row, bold so it anchors the line. */
export function stateGlyph(status: string): string {
  const { glyph, role } = stateOf(status);
  return strong(role, glyph);
}

/**
 * Glyph + label, e.g. a green `● running`. Use in tables and detail blocks
 * where the word itself has to be readable, not just the marker.
 */
export function stateLabel(status: string): string {
  const { glyph, role } = stateOf(status);
  return `${strong(role, glyph)} ${paint(role, status)}`;
}

/**
 * A dim bracketed kind, e.g. `[service]`. Uncoloured on purpose — see the
 * module header on the accent budget.
 */
export function kindBadge(kind: string): string {
  return dim(`[${kind}]`);
}
