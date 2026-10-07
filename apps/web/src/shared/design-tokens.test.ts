/**
 * Muted text clears WCAG AA (4.5:1) on every surface it sits on, in both
 * themes (DESIGN.md sets AA as the floor). The previous muted ink,
 * `#7a7a74`, read 4.17:1 on the canvas.
 *
 * Read straight from index.css, so a token edit that slips under the floor
 * fails here rather than in a browser.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const css = readFileSync(join(import.meta.dirname, "..", "index.css"), "utf8");

/** The `--name: #hex;` values declared inside one top-level block. */
function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const tokens = new Map<string, string>();
  for (const m of body.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    tokens.set(m[1] ?? "", (m[2] ?? "").toLowerCase());
  }
  return tokens;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** A translucent ink tint (`--muted` is 4% ink) composited onto a surface. */
function tint(surface: string, ink: string, alpha: number): string {
  const mix = (i: number) => {
    const s = Number.parseInt(surface.slice(1 + i * 2, 3 + i * 2), 16);
    const k = Number.parseInt(ink.slice(1 + i * 2, 3 + i * 2), 16);
    return Math.round(s * (1 - alpha) + k * alpha)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${mix(0)}${mix(1)}${mix(2)}`;
}

const AA = 4.5;

describe.each([
  // `film`: the heaviest ink tint muted text sits on, as alpha
  // over the surface named (#eeeeed on the light canvas, #1f1f1d over a
  // dark card).
  { theme: "light", selector: ":root", ink: "#141412", film: { on: "background", alpha: 0.06 } },
  { theme: "dark", selector: ".dark", ink: "#fbfbfa", film: { on: "card", alpha: 0.04 } },
])("muted text in $theme", ({ selector, ink, film }) => {
  const tokens = block(selector);
  const muted = tokens.get("muted-foreground") ?? "";
  const surfaces = {
    canvas: tokens.get("background") ?? "",
    card: tokens.get("card") ?? "",
    popover: tokens.get("popover") ?? "",
  };

  it.each(Object.entries(surfaces))("clears AA on the %s", (_name, surface) => {
    expect(contrast(muted, surface)).toBeGreaterThanOrEqual(AA);
  });

  it("clears AA on the heaviest muted fill it was measured on (hover rows, chips)", () => {
    const surface = tokens.get(film.on) ?? "";
    expect(contrast(muted, tint(surface, ink, film.alpha))).toBeGreaterThanOrEqual(AA);
  });
});

/**
 * The semantic text tones sit on their own tint in every status badge
 * (`bg-success/10` .. `/15` over the canvas). `#1f7a3f` measured
 * 4.42:1 and `#8a6a00` at 4.44:1 on those fills in light; the heaviest tint in
 * use is 15 %, so each tone must clear AA there.
 */
const HEAVIEST_BADGE_TINT = 0.15;

describe("semantic text tones on their badge tint (light)", () => {
  const tokens = block(":root");
  const canvas = tokens.get("background") ?? "";

  it.each(["success", "warning", "info", "destructive"])("%s clears AA", (name) => {
    const tone = tokens.get(name) ?? "";
    expect(contrast(tone, tint(canvas, tone, HEAVIEST_BADGE_TINT))).toBeGreaterThanOrEqual(AA);
  });
});
