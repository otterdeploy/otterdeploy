/**
 * Rasterises the brand SVGs into every PNG the product actually ships.
 *
 * Chromium is the renderer on purpose: the favicons and app icons are consumed
 * by browsers, so rasterising through the same engine means what we ship is
 * exactly what a browser draws. Everything derives from brand/logo/*.svg — no
 * PNG is hand-authored, so a geometry change reflows the whole kit.
 *
 * Run `brand/scripts/build.sh`; this script is step 3 of 4.
 */

/// <reference lib="dom" />
// ^ The `page.evaluate` callbacks below are serialised and run inside Chromium,
//   so they reference browser globals. The repo's base tsconfig is lib:["ESNext"]
//   (this is a Node script), which leaves `document` unresolved without this.

import { chromium, type Browser } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const LOGO = `${ROOT}/brand/logo`;
const DIST = `${ROOT}/brand/dist`;

/**
 * Every app that serves the icon set from its own origin. The dashboard and
 * the marketing/docs site are separate deployments, so each needs its own
 * copy — but only one of them may be the source of truth for the artwork, and
 * that's this script. Add an app here rather than copying PNGs between
 * public/ dirs.
 */
const APP_PUBLIC = [`${ROOT}/apps/web/public`, `${ROOT}/apps/www/public`];

const INK = "#141412";
const INK_DARK = "#f5f5f0";
const CANVAS = "#fbfbfa";
const CANVAS_DARK = "#0c0c0b";
const MUTED = "#7a7a74";
const MUTED_DARK = "#7a7a72";
const ACCENT = "#1d4ed8";
const ACCENT_DARK = "#3b82f6";

const svgCache = new Map<string, string>();
async function svg(name: string): Promise<string> {
  const cached = svgCache.get(name);
  if (cached !== undefined) return cached;

  const loaded = await readFile(`${LOGO}/${name}`, "utf8");
  svgCache.set(name, loaded);
  return loaded;
}

interface Shot { path: string; html: string; width: number; height: number; transparent?: boolean }

/** A bare mark or lockup on nothing — transparent PNG at an exact pixel size. */
async function bare(file: string, source: string, width: number, height = width): Promise<Shot> {
  const markup = (await svg(source))
    .replace(/width="[^"]*"/, `width="${width}"`)
    .replace(/height="[^"]*"/, `height="${height}"`);
  return {
    path: file,
    width,
    height,
    transparent: true,
    html: `<div style="width:${width}px;height:${height}px;line-height:0">${markup}</div>`,
  };
}

/**
 * A mark seated on an opaque tile. `inset` is the fraction of the tile left as
 * padding on each side — maskable icons need a large one so the mark survives
 * the platform cropping it to a circle.
 */
async function tile(
  file: string,
  size: number,
  { dark = false, inset = 0.2, radius = 0 } = {},
): Promise<Shot> {
  const inner = Math.round(size * (1 - inset * 2));
  const markup = (await svg(dark ? "mark-dark.svg" : "mark-light.svg"))
    .replace(/width="[^"]*"/, `width="${inner}"`)
    .replace(/height="[^"]*"/, `height="${inner}"`);
  return {
    path: file,
    width: size,
    height: size,
    html: `<div style="width:${size}px;height:${size}px;display:grid;place-items:center;
      background:${dark ? CANVAS_DARK : CANVAS};border-radius:${radius}px">${markup}</div>`,
  };
}

/** 1200x630 social card. Lockup, product line, and a mono footer of what it is. */
async function ogCard(file: string, dark: boolean): Promise<Shot> {
  const ink = dark ? INK_DARK : INK;
  const muted = dark ? MUTED_DARK : MUTED;
  const accent = dark ? ACCENT_DARK : ACCENT;
  // The outlined lockup, not live text — so the card's wordmark is byte-identical
  // to every other place the lockup appears.
  const lockup = (await svg(dark ? "lockup-dark.svg" : "lockup-light.svg"))
    .replace(/width="[^"]*"/, 'width="335"')
    .replace(/height="[^"]*"/, 'height="70"');

  return {
    path: file,
    width: 1200,
    height: 630,
    html: `
      <div style="width:1200px;height:630px;background:${dark ? CANVAS_DARK : CANVAS};
        color:${ink};display:flex;flex-direction:column;justify-content:space-between;
        padding:76px 84px;box-sizing:border-box;font-family:Geist;letter-spacing:-0.005em">
        <div style="line-height:0">${lockup}</div>
        <div>
          <div style="font-size:66px;font-weight:600;letter-spacing:-0.032em;line-height:1.1;max-width:15ch">
            Calm, confident<br/>infrastructure.
          </div>
          <div style="margin-top:26px;font-size:27px;line-height:1.45;color:${muted};max-width:44ch">
            Self-hostable deployments — build, ship, and operate your services on your own servers.
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:14px;font-family:'Geist Mono';
          font-feature-settings:'zero','ss03';font-size:21px;color:${muted}">
          <span style="width:9px;height:9px;border-radius:9999px;background:${accent}"></span>
          <span>git push → build → deploy</span>
        </div>
      </div>`,
  };
}

/** The per-app icon set, rendered once per entry in APP_PUBLIC. */
async function appShots(out: string): Promise<Shot[]> {
  return [
    // Legacy raster favicons. Modern browsers take favicon.svg (theme-adaptive);
    // these are the fallback, so they use the light-surface ink.
    await bare(`${out}/favicon-16x16.png`, "mark-light.svg", 16),
    await bare(`${out}/favicon-32x32.png`, "mark-light.svg", 32),
    await bare(`${out}/favicon-48x48.png`, "mark-light.svg", 48),
    await bare(`${out}/favicon-96x96.png`, "mark-light.svg", 96),

    // iOS never honours transparency here — it composites on black. Opaque tile.
    await tile(`${out}/apple-touch-icon.png`, 180, { inset: 0.18 }),

    await tile(`${out}/icon-192.png`, 192, { inset: 0.2 }),
    await tile(`${out}/icon-512.png`, 512, { inset: 0.2 }),
    // Maskable: platform may crop to a circle inscribed in the middle 80%.
    await tile(`${out}/icon-maskable-512.png`, 512, { inset: 0.28 }),

    await ogCard(`${out}/og.png`, false),
    await ogCard(`${out}/og-dark.png`, true),
  ];
}

async function main() {
  const perApp = await Promise.all(APP_PUBLIC.map(appShots));
  const shots: Shot[] = [
    ...perApp.flat(),

    // Docs/README artwork at 2x.
    await bare(`${DIST}/lockup-light@2x.png`, "lockup-light.svg", 612, 128),
    await bare(`${DIST}/lockup-dark@2x.png`, "lockup-dark.svg", 612, 128),
    await bare(`${DIST}/mark-light@2x.png`, "mark-light.svg", 256),
    await bare(`${DIST}/mark-dark@2x.png`, "mark-dark.svg", 256),
  ];

  const browser: Browser = await chromium.launch();
  const fonts = await fontFaceCss();

  for (const shot of shots) {
    const page = await browser.newPage({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<style>*{margin:0;padding:0;box-sizing:border-box}${fonts}</style>${shot.html}`,
      { waitUntil: "load" },
    );
    await page.evaluate(() => document.fonts.ready);
    await mkdir(dirname(shot.path), { recursive: true });
    await page.screenshot({ path: shot.path, omitBackground: shot.transparent ?? false });
    await page.close();
    console.log(`  ${shot.width}x${shot.height}  ${shot.path.replace(`${ROOT}/`, "")}`);
  }
  await browser.close();

  // favicon.svg is the mark verbatim — it is the only asset browsers scale
  // themselves, so it stays vector and theme-adaptive.
  const markSvg = await svg("mark.svg");
  for (const out of APP_PUBLIC) {
    await mkdir(out, { recursive: true });
    await writeFile(`${out}/favicon.svg`, markSvg);
    console.log(`  vector       ${out.replace(`${ROOT}/`, "")}/favicon.svg`);
  }
}

/** Inlines Geist as data URIs so rendering never depends on network or system fonts. */
async function fontFaceCss(): Promise<string> {
  const face = async (family: string, file: string) => {
    const b64 = (await readFile(`${ROOT}/brand/fonts/${file}`)).toString("base64");
    return `@font-face{font-family:'${family}';font-weight:100 900;
      src:url(data:font/woff2;base64,${b64}) format('woff2-variations')}`;
  };
  return (await face("Geist", "geist.woff2")) + (await face("Geist Mono", "geist-mono.woff2"));
}

await main();
