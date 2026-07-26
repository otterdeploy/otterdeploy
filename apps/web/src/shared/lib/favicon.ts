/**
 * Paints the brand mark into the browser tab, carrying live system state.
 *
 * Why canvas and not just swapping `favicon.svg`: no browser animates an SVG
 * favicon. Chrome renders the first frame and stops, Safari ignores SMIL and
 * CSS animation there entirely. The only way to show a deploy actually moving
 * in the tab is to rasterise frames ourselves and re-point the icon link.
 *
 * Everything is driven from the generated geometry, so the tab mark and the
 * in-app mark are the same shape by construction.
 */

import {
  MARK_ARC,
  MARK_GLYPHS,
  MARK_GRID,
  MARK_INK,
  MARK_RING,
  MARK_STATUS_COLORS,
  MARK_STROKE,
  type MarkStatus,
} from "@/shared/components/brand/mark-geometry";

/**
 * 64px, not 32: browsers pick the icon for a HiDPI tab strip and downscale, and
 * a 32px source resamples to visible mush on a 2x display. One raster at 2x
 * covers every tab size in use.
 */
const CANVAS_PX = 64;
const SCALE = CANVAS_PX / MARK_GRID;

/** ~12fps. The arc is a slow sweep; more frames buys nothing and costs wakeups. */
const FRAME_MS = 80;

/** Icon links this module owns. Static declarations in index.html are left
 *  alone so the pre-JS paint and the .ico fallback still work. */
const MANAGED_REL = "icon";
const MANAGED_ID = "od-live-favicon";

interface Painter {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

let painter: Painter | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let current: MarkStatus = "idle";
let startedAt = 0;

function getPainter(): Painter | null {
  if (painter) return painter;
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_PX;
  canvas.height = CANVAS_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null; // headless/blocked canvas — leave the static icon up
  painter = { canvas, ctx };
  return painter;
}

function prefersDark(): boolean {
  // The *browser chrome's* scheme, deliberately — not the app's theme. The icon
  // sits in the tab strip, so it has to contrast with the tab strip.
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Rounded-rect ring path, in the 32-unit grid scaled to the canvas. */
function ringPath(): Path2D {
  const p = new Path2D();
  const { x, y, width, height, rx } = MARK_RING;
  const args = [x * SCALE, y * SCALE, width * SCALE, height * SCALE] as const;
  // Path2D.roundRect is Chrome 99 / Safari 16.4 / Firefox 112. On anything
  // older a square ring is wrong but legible; throwing would blank the tab.
  if (typeof p.roundRect === "function") p.roundRect(...args, rx * SCALE);
  else p.rect(...args);
  return p;
}

/**
 * Perimeter of the ring, needed because canvas dash lengths are absolute while
 * the SVG uses `pathLength="100"`. Measured once from the same rounded-rect
 * maths the path uses: four straight runs plus one full ellipse of corners.
 */
const RING_PERIMETER =
  (2 * (MARK_RING.width - 2 * MARK_RING.rx) +
    2 * (MARK_RING.height - 2 * MARK_RING.rx) +
    2 * Math.PI * MARK_RING.rx) *
  SCALE;

function paint(status: MarkStatus, elapsedMs: number): string | null {
  const p = getPainter();
  if (!p) return null;
  const { canvas, ctx } = p;
  const dark = prefersDark();
  const ink = dark ? MARK_INK.dark : MARK_INK.light;
  const accent = dark ? MARK_STATUS_COLORS[status].dark : MARK_STATUS_COLORS[status].light;

  ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);
  ctx.lineWidth = MARK_STROKE * SCALE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const deploying = status === "deploying";

  // Ring — dimmed to a track while something is in flight.
  ctx.globalAlpha = deploying ? 0.2 : 1;
  ctx.strokeStyle = ink;
  ctx.setLineDash([]);
  ctx.stroke(ringPath());
  ctx.globalAlpha = 1;

  if (deploying) {
    const [on, off] = MARK_ARC.dashArray.split(" ").map(Number);
    const unit = RING_PERIMETER / MARK_ARC.pathLength;
    ctx.strokeStyle = accent;
    ctx.setLineDash([on * unit, off * unit]);
    ctx.lineDashOffset = prefersReducedMotion()
      ? MARK_ARC.staticOffset * unit
      : -((elapsedMs % MARK_ARC.durationMs) / MARK_ARC.durationMs) * RING_PERIMETER;
    ctx.stroke(ringPath());
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  // Counter. The glyphs are authored in grid units and scaled by transform, so
  // the path data here stays byte-identical to the SVG's.
  ctx.strokeStyle = accent;
  for (const d of MARK_GLYPHS[status]) {
    const scaled = new Path2D();
    scaled.addPath(new Path2D(d), { a: SCALE, b: 0, c: 0, d: SCALE, e: 0, f: 0 });
    ctx.stroke(scaled);
  }

  return canvas.toDataURL("image/png");
}

/** The link element we repaint. Created once, appended to the head. */
function managedLink(): HTMLLinkElement {
  const existing = document.getElementById(MANAGED_ID);
  if (existing instanceof HTMLLinkElement) return existing;
  const link = document.createElement("link");
  link.id = MANAGED_ID;
  link.rel = MANAGED_REL;
  link.type = "image/png";
  document.head.append(link);
  return link;
}

function removeManagedLink(): void {
  document.getElementById(MANAGED_ID)?.remove();
}

/** Static icon declarations pulled out of the way, kept so we can put them back. */
let suppressed: HTMLLinkElement[] = [];

/**
 * Removes the competing static `<link rel="icon">` declarations from index.html.
 *
 * This is load-bearing, not tidying. index.html ships an SVG icon, and a browser
 * elects ONE icon from everything declared: Chrome takes the scalable SVG and
 * scales it itself (index.html says as much), so it never looks at the canvas
 * PNG we append and the tab stays frozen on the static mark no matter what we
 * paint. Adding our link "first" wouldn't fix it either — election is by type
 * and size, not document order. The only deterministic answer is to leave
 * exactly one icon link in the document, so there is nothing to elect.
 *
 * `rel~="icon"` matches `icon` and `shortcut icon` but not `apple-touch-icon`
 * (a single different token), so the homescreen icon and the manifest are left
 * alone — neither participates in tab-strip election.
 *
 * Called only after a frame has actually painted, so a blocked or headless
 * canvas leaves the static icons up rather than stripping the tab bare.
 */
function suppressStaticIcons(): void {
  if (suppressed.length > 0) return;
  for (const link of document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) {
    if (link.id === MANAGED_ID) continue;
    suppressed.push(link);
    link.remove();
  }
}

function restoreStaticIcons(): void {
  for (const link of suppressed) document.head.append(link);
  suppressed = [];
}

function stopLoop(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

function render(): void {
  const href = paint(current, performance.now() - startedAt);
  // No canvas (headless, blocked) — leave the static icons in place untouched.
  if (!href) return;
  // Point ours at the frame BEFORE removing the others, so there is never a
  // moment where the document declares no icon at all.
  managedLink().href = href;
  suppressStaticIcons();
}

/**
 * Repaints when the browser chrome flips light/dark. Without this, a tab left
 * open across a theme change keeps an icon painted for the old tab strip.
 * Attached lazily on first use and never detached — one listener per document.
 */
let schemeWatcher: MediaQueryList | null = null;
function watchScheme(): void {
  if (schemeWatcher) return;
  schemeWatcher = window.matchMedia("(prefers-color-scheme: dark)");
  schemeWatcher.addEventListener("change", () => {
    if (document.getElementById(MANAGED_ID)) render();
  });
}

/**
 * Points the tab at `status`.
 *
 * Every state is painted, idle included, rather than deleting the link and
 * hoping the browser falls back to `favicon.svg`. Fallback-on-removal is
 * inconsistent across browsers, and a tab that silently loses its icon is a
 * worse failure than rasterising a state we could have drawn as vector.
 */
export function setFaviconStatus(status: MarkStatus): void {
  if (typeof document === "undefined") return;
  // Re-entering `deploying` while its loop is already running is a no-op; any
  // other repeat is too. Without the timer check a re-render would restart the
  // sweep from zero and make the arc stutter.
  if (status === current && (status !== "deploying" || timer !== null)) return;

  watchScheme();
  current = status;
  stopLoop();
  startedAt = performance.now();
  render();

  // Only the in-flight state animates. Static states are painted once and left
  // alone, so a tab sitting on "error" costs nothing.
  if (status === "deploying" && !prefersReducedMotion()) {
    timer = setInterval(render, FRAME_MS);
  }
}

/** Tears down the loop and restores the static icon. For tests and teardown. */
export function resetFavicon(): void {
  stopLoop();
  removeManagedLink();
  // Put index.html's declarations back, or teardown would leave the tab with no
  // icon at all — worse than the static one we replaced.
  restoreStaticIcons();
  current = "idle";
}
