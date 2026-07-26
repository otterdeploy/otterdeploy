#!/usr/bin/env python3
"""
Composes every otterdeploy SVG asset from one geometry definition.

The mark is a slashed zero: the product's own `rounded-lg` node silhouette as
the ring, DESIGN.md's slashed-zero detail as the counter. Ink is warm-black
(never pure `#000`), and the slash is the single Signal Blue — the only
chromatic mark in the system (The One Voice Rule).

Run `brand/scripts/build.sh`; this script is step 2 of 4.
"""

from __future__ import annotations

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOGO = ROOT / "brand/logo"

# --- Palette (DESIGN.md) ----------------------------------------------------
INK = "#141412"  # Warm Ink — never pure black
INK_DARK = "#f5f5f0"
ACCENT = "#1d4ed8"  # Signal Blue, oklch(0.488 0.243 264.376)
ACCENT_DARK = "#3b82f6"  # the brighter cut, oklch(0.623 0.214 259.815)
CANVAS = "#fbfbfa"
CANVAS_DARK = "#0c0c0b"

# Semantic state colours, straight from DESIGN.md §2. Each pair clears 4.5:1 on
# its own canvas, so a state is legible in either theme without adjustment.
SUCCESS, SUCCESS_DARK = "#1f7a3f", "#4ade80"
WARNING, WARNING_DARK = "#8a6a00", "#fbbf24"
DESTRUCTIVE, DESTRUCTIVE_DARK = "#b42318", "#f87171"

# --- Mark geometry, 32x32 grid ---------------------------------------------
# Authored at favicon scale so nothing needs re-fitting when it gets small.
STROKE = 2.6
RING_BOX = {"x": 4.6, "y": 4.6, "width": 22.8, "height": 22.8, "rx": 7.1}
RING = " ".join(f'{k}="{v}"' for k, v in RING_BOX.items())
SLASH = "M10.6 21.4 21.4 10.6"

# --- Status vocabulary ------------------------------------------------------
# The ring is constant — it is the brand. Only the counter changes, and it
# changes SHAPE, not just colour: at 16px in a tab strip, and for a colour-blind
# operator, hue alone carries nothing (DESIGN.md: "pair semantic colour with an
# icon ... so state never depends on colour alone").
#
# `deploying` keeps the idle slash and animates the ring instead, reusing the
# comet-border vocabulary the project graph already uses for pending work.
#
# A zero-length path with a round cap renders as a dot of stroke diameter, which
# is how the warning glyph gets its point without introducing a second element
# type. Every glyph is one stroked path list.
STATUS_GLYPHS: dict[str, list[str]] = {
    "idle": [SLASH],
    "deploying": [SLASH],
    # A check.
    "success": ["M11.2 16.4 14.8 20 21 12.8"],
    # A bang: bar over dot.
    "warning": ["M16 10.2 16 17", "M16 21.1 16 21.1"],
    # The slash, crossed by its own mirror — failure defacing the identity.
    "error": ["M11.8 11.8 20.2 20.2", "M20.2 11.8 11.8 20.2"],
}

STATUS_COLORS: dict[str, tuple[str, str]] = {
    "idle": (ACCENT, ACCENT_DARK),
    "deploying": (ACCENT, ACCENT_DARK),
    "success": (SUCCESS, SUCCESS_DARK),
    "warning": (WARNING, WARNING_DARK),
    "error": (DESTRUCTIVE, DESTRUCTIVE_DARK),
}

# The travelling arc: `pathLength` normalises the rounded-rect perimeter to 100
# so the dash pattern is expressible as a percentage regardless of geometry.
ARC_DASH = "28 72"
ARC_DURATION = "2.2s"  # matches --comet-spin in apps/web/src/index.css
# Where the arc parks when the viewer has asked for less motion: top-right,
# reading as "in progress" without moving.
ARC_STATIC_OFFSET = -6

# --- Lockup metrics ---------------------------------------------------------
MARK = 32.0
FONT_SIZE = 21.0  # ~0.66 of the mark — matches the app header's optical ratio
GAP = 11.0
STACK_GAP = 9.0


def ring(color: str, cls: str = "") -> str:
    c = f' class="{cls}"' if cls else ""
    return f'<rect {RING} fill="none" stroke="{color}" stroke-width="{STROKE}"{c}/>'


def slash(color: str, cls: str = "") -> str:
    c = f' class="{cls}"' if cls else ""
    return (
        f'<path d="{SLASH}" fill="none" stroke="{color}" stroke-width="{STROKE}"'
        f' stroke-linecap="round"{c}/>'
    )


def svg(view_w: float, view_h: float, body: str, *, style: str = "", title: str) -> str:
    s = f"\n  <style>{style}</style>" if style else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_n(view_w)} {_n(view_h)}"'
        f' width="{_n(view_w)}" height="{_n(view_h)}" fill="none" role="img"'
        f' aria-label="{title}">{s}\n  {body}\n</svg>\n'
    )


def _n(v: float) -> str:
    return f"{v:g}" if isinstance(v, float) else str(v)


# Inverts both ink and accent when the viewer is in dark mode. Used for
# favicon.svg and any asset that must sit on an unknown surface.
ADAPTIVE_STYLE = (
    f"@media(prefers-color-scheme:dark){{"
    f".ink{{stroke:{INK_DARK};fill:{INK_DARK}}}"
    f".accent{{stroke:{ACCENT_DARK};fill:{ACCENT_DARK}}}}}"
)


def build_marks(out: dict[str, str]) -> None:
    title = "otterdeploy"

    out["mark.svg"] = svg(
        32, 32, ring(INK, "ink") + "\n  " + slash(ACCENT, "accent"),
        style=ADAPTIVE_STYLE, title=title,
    )
    out["mark-light.svg"] = svg(32, 32, ring(INK) + "\n  " + slash(ACCENT), title=title)
    out["mark-dark.svg"] = svg(32, 32, ring(INK_DARK) + "\n  " + slash(ACCENT_DARK), title=title)
    # Single-colour: inherits from the caller, for inline use and one-colour print.
    out["mark-mono.svg"] = svg(
        32, 32, ring("currentColor") + "\n  " + slash("currentColor"), title=title
    )


def glyph(paths: list[str], color: str, cls: str = "") -> str:
    c = f' class="{cls}"' if cls else ""
    return "\n  ".join(
        f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{STROKE}"'
        f' stroke-linecap="round" stroke-linejoin="round"{c}/>'
        for d in paths
    )


# The travelling arc, as CSS inside the SVG so a standalone file animates in an
# <img> and still honours the viewer's motion preference. The favicon does not
# use this — browsers refuse to animate SVG favicons, so that path renders
# frames to a canvas instead (see apps/web/src/shared/lib/favicon.ts).
ARC_STYLE = (
    f"@keyframes od-arc{{to{{stroke-dashoffset:-100}}}}"
    f".arc{{animation:od-arc {ARC_DURATION} linear infinite}}"
    f"@media(prefers-reduced-motion:reduce){{"
    f".arc{{animation:none;stroke-dashoffset:{ARC_STATIC_OFFSET}}}}}"
)


TRACK_STYLE = ".track{opacity:.2}"


def status_body(status: str, ink: str, color: str, *, themed: bool) -> str:
    """The ring plus this status's counter. `themed` tags the elements so the
    adaptive stylesheet can repaint them for a dark viewer."""
    ink_cls, state_cls = ("ink", "state") if themed else ("", "")
    paths = STATUS_GLYPHS[status]

    if status != "deploying":
        return f"{ring(ink, ink_cls)}\n  {glyph(paths, color, state_cls)}"

    # Deploying keeps the idle slash — identity does not blink out mid-deploy —
    # and layers a travelling arc over a dimmed copy of the ring.
    track = ring(ink, " ".join(c for c in (ink_cls, "track") if c))
    arc_cls = " ".join(c for c in ("arc", state_cls) if c)
    arc = (
        f'<rect {RING} fill="none" stroke="{color}" stroke-width="{STROKE}"'
        f' stroke-linecap="round" pathLength="100" stroke-dasharray="{ARC_DASH}"'
        f' class="{arc_cls}"/>'
    )
    return f"{track}\n  {arc}\n  {glyph(paths, color, state_cls)}"


def build_status_marks(out: dict[str, str]) -> None:
    """One file per (status, theme), plus a theme-adaptive cut of each."""
    for status in STATUS_GLYPHS:
        if status == "idle":
            continue  # already shipped as mark.svg / -light / -dark
        light, dark = STATUS_COLORS[status]
        title = f"otterdeploy — {status}"
        motion = (ARC_STYLE + TRACK_STYLE) if status == "deploying" else ""

        out[f"mark-{status}.svg"] = svg(
            32, 32, status_body(status, INK, light, themed=True),
            # The adaptive sheet repaints `.ink`; the state colour rides `.state`.
            style=ADAPTIVE_STYLE.replace(".accent{", ".state{").replace(
                ACCENT_DARK, dark
            ) + motion,
            title=title,
        )
        out[f"mark-{status}-light.svg"] = svg(
            32, 32, status_body(status, INK, light, themed=False), style=motion, title=title
        )
        out[f"mark-{status}-dark.svg"] = svg(
            32, 32, status_body(status, INK_DARK, dark, themed=False), style=motion, title=title
        )


def build_lockups(wm: dict, out: dict[str, str]) -> None:
    scale = FONT_SIZE / wm["unitsPerEm"]
    bb = wm["bbox"]
    ink_w = (bb["xMax"] - bb["xMin"]) * scale
    ink_h = (bb["yMax"] - bb["yMin"]) * scale

    # --- Horizontal: mark, gap, wordmark optically centred on the mark ---
    width = MARK + GAP + ink_w
    # Centre the *inked* box (ascender-to-descender), not the baseline.
    top = (MARK - ink_h) / 2
    baseline_y = top - bb["yMin"] * scale
    word_x = MARK + GAP - bb["xMin"] * scale
    word_tf = f'transform="translate({word_x:.4g} {baseline_y:.4g}) scale({scale:.6g})"'

    def horizontal(ink: str, accent: str, style: str = "") -> str:
        cls_i, cls_a = ("ink", "accent") if style else ("", "")
        body = (
            f'{ring(ink, cls_i)}\n  {slash(accent, cls_a)}\n  '
            f'<path {word_tf} fill="{ink}"'
            f'{f" class={chr(34)}{cls_i}{chr(34)}" if cls_i else ""} d="{wm["path"]}"/>'
        )
        return svg(width, MARK, body, style=style, title="otterdeploy")

    out["lockup.svg"] = horizontal(INK, ACCENT, ADAPTIVE_STYLE)
    out["lockup-light.svg"] = horizontal(INK, ACCENT)
    out["lockup-dark.svg"] = horizontal(INK_DARK, ACCENT_DARK)
    out["lockup-mono.svg"] = horizontal("currentColor", "currentColor")

    # --- Stacked: mark centred above the wordmark ---
    s_w = max(MARK, ink_w)
    s_h = MARK + STACK_GAP + ink_h
    mark_x = (s_w - MARK) / 2
    s_word_x = (s_w - ink_w) / 2 - bb["xMin"] * scale
    s_baseline = MARK + STACK_GAP - bb["yMin"] * scale
    body = (
        f'<g transform="translate({mark_x:.4g} 0)">{ring(INK, "ink")}{slash(ACCENT, "accent")}</g>\n  '
        f'<path transform="translate({s_word_x:.4g} {s_baseline:.4g}) scale({scale:.6g})"'
        f' fill="{INK}" class="ink" d="{wm["path"]}"/>'
    )
    out["lockup-stacked.svg"] = svg(s_w, s_h, body, style=ADAPTIVE_STYLE, title="otterdeploy")

    print(f"lockup: {width:.1f}x{MARK:.0f}  stacked: {s_w:.1f}x{s_h:.1f}")


GEOMETRY_TS_TARGETS = (
    ROOT / "apps/web/src/shared/components/brand/mark-geometry.ts",
    ROOT / "apps/www/src/components/brand/mark-geometry.ts",
)


def write_geometry_ts() -> None:
    """Emits the mark's geometry as a TypeScript module for each app.

    The React component and the canvas favicon renderer both need these exact
    numbers. Hand-copying them into TS is how a mark drifts from its own
    favicon, so the Python build owns the values and generates the module.

    The dashboard and the marketing site can't import across app boundaries,
    so both get a generated copy rather than one hand-maintained duplicate.
    """
    statuses = list(STATUS_GLYPHS)

    def ts_record(body: str) -> str:
        return "{\n" + body + "\n}"

    glyphs = "\n".join(
        f"  {s}: [{', '.join(json.dumps(d) for d in STATUS_GLYPHS[s])}]," for s in statuses
    )
    colors = "\n".join(
        f'  {s}: {{ light: "{STATUS_COLORS[s][0]}", dark: "{STATUS_COLORS[s][1]}" }},'
        for s in statuses
    )
    ring_fields = ", ".join(f"{k}: {v}" for k, v in RING_BOX.items())

    module = f"""/**
 * GENERATED by brand/scripts/build_svgs.py — do not edit by hand.
 * Run `brand/scripts/build.sh` to regenerate.
 *
 * The mark's geometry, shared by the React component and the canvas favicon
 * renderer so the in-app mark and the browser-tab mark can never drift apart.
 */

/** What the counter inside the ring is saying. The ring itself never changes. */
export type MarkStatus = {" | ".join(f'"{s}"' for s in statuses)};

export const MARK_STATUSES = [{", ".join(f'"{s}"' for s in statuses)}] as const;

export const MARK_VIEW_BOX = "0 0 32 32";
export const MARK_GRID = 32;
export const MARK_STROKE = {STROKE};
export const MARK_RING = {{ {ring_fields} }} as const;

/**
 * The travelling arc for `deploying`. `pathLength` normalises the rounded-rect
 * perimeter to 100, so the dash pattern is a percentage of the ring.
 */
export const MARK_ARC = {{
  dashArray: "{ARC_DASH}",
  pathLength: 100,
  durationMs: {int(float(ARC_DURATION.rstrip("s")) * 1000)},
  /** Where the arc parks under `prefers-reduced-motion: reduce`. */
  staticOffset: {ARC_STATIC_OFFSET},
}} as const;

/** Stroked paths for each status's counter. A zero-length path is a round dot. */
export const MARK_GLYPHS: Record<MarkStatus, readonly string[]> = {ts_record(glyphs)};

export const MARK_STATUS_COLORS: Record<MarkStatus, {{ light: string; dark: string }}> =
  {ts_record(colors)};

/** The ring, in both themes. Warm ink — never pure black or white. */
export const MARK_INK = {{ light: "{INK}", dark: "{INK_DARK}" }} as const;
"""

    for target in GEOMETRY_TS_TARGETS:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(module)


def main() -> None:
    wm = json.loads((LOGO / "_wordmark.json").read_text())
    out: dict[str, str] = {}
    build_marks(out)
    build_status_marks(out)
    build_lockups(wm, out)

    LOGO.mkdir(parents=True, exist_ok=True)
    for name, content in out.items():
        (LOGO / name).write_text(content)
    print(f"wrote {len(out)} svgs -> brand/logo/")

    write_geometry_ts()
    for target in GEOMETRY_TS_TARGETS:
        print(f"wrote {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
