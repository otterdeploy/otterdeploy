#!/usr/bin/env node
/**
 * Regenerate the vendored world-map path data behind the Analytics page's
 * visitors-by-country choropleth.
 *
 * The dashboard has no mapping library on purpose: a choropleth needs exactly
 * one thing — a country outline per ISO-3166-1 alpha-2 code — and pulling in
 * d3-geo + topojson + a TopoJSON asset to compute that at runtime would add
 * three dependencies for a static picture. So this script does the projection
 * ONCE, at maintainer time, and commits plain SVG path strings. (Approach
 * borrowed from openship's monitoring map; same public-domain source.)
 *
 * Source: world-atlas (Natural Earth, public domain), 110m resolution: the
 * right detail for a card-sized map and small enough to commit.
 *
 * Projection: equirectangular, computed inline. Longitude/latitude map
 * linearly to x/y, so the output is a plain 360x180 viewBox and the client
 * needs zero projection code.
 *
 * Usage:
 *   bun apps/web/scripts/update-world-map.mjs
 *   WORLD_ATLAS_URL=<mirror> bun apps/web/scripts/update-world-map.mjs
 * Commit the resulting JSON.
 */
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ATLAS =
  process.env.WORLD_ATLAS_URL?.trim() ||
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// ISO 3166-1 numeric → alpha-2 (standards data). Natural Earth keys countries
// by numeric id, but everything on our side (GeoIP enrichment, edge_stat_day
// `countries` keys, the API) speaks alpha-2, so resolve it at generation time.
const NUMERIC_TO_ALPHA2 = {
  4: "AF",
  8: "AL",
  12: "DZ",
  16: "AS",
  20: "AD",
  24: "AO",
  28: "AG",
  31: "AZ",
  32: "AR",
  36: "AU",
  40: "AT",
  44: "BS",
  48: "BH",
  50: "BD",
  51: "AM",
  52: "BB",
  56: "BE",
  60: "BM",
  64: "BT",
  68: "BO",
  70: "BA",
  72: "BW",
  74: "BV",
  76: "BR",
  84: "BZ",
  86: "IO",
  90: "SB",
  92: "VG",
  96: "BN",
  100: "BG",
  104: "MM",
  108: "BI",
  112: "BY",
  116: "KH",
  120: "CM",
  124: "CA",
  132: "CV",
  136: "KY",
  140: "CF",
  144: "LK",
  148: "TD",
  152: "CL",
  156: "CN",
  158: "TW",
  162: "CX",
  166: "CC",
  170: "CO",
  174: "KM",
  175: "YT",
  178: "CG",
  180: "CD",
  184: "CK",
  188: "CR",
  191: "HR",
  192: "CU",
  196: "CY",
  203: "CZ",
  204: "BJ",
  208: "DK",
  212: "DM",
  214: "DO",
  218: "EC",
  222: "SV",
  226: "GQ",
  231: "ET",
  232: "ER",
  233: "EE",
  234: "FO",
  238: "FK",
  239: "GS",
  242: "FJ",
  246: "FI",
  248: "AX",
  250: "FR",
  254: "GF",
  258: "PF",
  260: "TF",
  262: "DJ",
  266: "GA",
  268: "GE",
  270: "GM",
  275: "PS",
  276: "DE",
  288: "GH",
  292: "GI",
  296: "KI",
  300: "GR",
  304: "GL",
  308: "GD",
  312: "GP",
  316: "GU",
  320: "GT",
  324: "GN",
  328: "GY",
  332: "HT",
  334: "HM",
  336: "VA",
  340: "HN",
  344: "HK",
  348: "HU",
  352: "IS",
  356: "IN",
  360: "ID",
  364: "IR",
  368: "IQ",
  372: "IE",
  376: "IL",
  380: "IT",
  384: "CI",
  388: "JM",
  392: "JP",
  398: "KZ",
  400: "JO",
  404: "KE",
  408: "KP",
  410: "KR",
  414: "KW",
  417: "KG",
  418: "LA",
  422: "LB",
  426: "LS",
  428: "LV",
  430: "LR",
  434: "LY",
  438: "LI",
  440: "LT",
  442: "LU",
  446: "MO",
  450: "MG",
  454: "MW",
  458: "MY",
  462: "MV",
  466: "ML",
  470: "MT",
  474: "MQ",
  478: "MR",
  480: "MU",
  484: "MX",
  492: "MC",
  496: "MN",
  498: "MD",
  499: "ME",
  500: "MS",
  504: "MA",
  508: "MZ",
  512: "OM",
  516: "NA",
  520: "NR",
  524: "NP",
  528: "NL",
  531: "CW",
  533: "AW",
  534: "SX",
  535: "BQ",
  540: "NC",
  548: "VU",
  554: "NZ",
  558: "NI",
  562: "NE",
  566: "NG",
  570: "NU",
  574: "NF",
  578: "NO",
  580: "MP",
  581: "UM",
  583: "FM",
  584: "MH",
  585: "PW",
  586: "PK",
  591: "PA",
  598: "PG",
  600: "PY",
  604: "PE",
  608: "PH",
  612: "PN",
  616: "PL",
  620: "PT",
  624: "GW",
  626: "TL",
  630: "PR",
  634: "QA",
  638: "RE",
  642: "RO",
  643: "RU",
  646: "RW",
  652: "BL",
  654: "SH",
  659: "KN",
  660: "AI",
  662: "LC",
  663: "MF",
  666: "PM",
  670: "VC",
  674: "SM",
  678: "ST",
  682: "SA",
  686: "SN",
  688: "RS",
  690: "SC",
  694: "SL",
  702: "SG",
  703: "SK",
  704: "VN",
  705: "SI",
  706: "SO",
  710: "ZA",
  716: "ZW",
  724: "ES",
  728: "SS",
  729: "SD",
  732: "EH",
  740: "SR",
  744: "SJ",
  748: "SZ",
  752: "SE",
  756: "CH",
  760: "SY",
  762: "TJ",
  764: "TH",
  768: "TG",
  772: "TK",
  776: "TO",
  780: "TT",
  784: "AE",
  788: "TN",
  792: "TR",
  795: "TM",
  796: "TC",
  798: "TV",
  800: "UG",
  804: "UA",
  807: "MK",
  818: "EG",
  826: "GB",
  831: "GG",
  832: "JE",
  833: "IM",
  834: "TZ",
  840: "US",
  850: "VI",
  854: "BF",
  858: "UY",
  860: "UZ",
  862: "VE",
  876: "WF",
  882: "WS",
  887: "YE",
  894: "ZM",
};

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "features",
  "analytics",
  "country-paths.json",
);

/** TopoJSON arcs are delta-encoded and quantized: undo both (spec §2.1.3). */
function decodeArc(arc, transform) {
  const {
    scale: [sx, sy],
    translate: [tx, ty],
  } = transform;
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * sx + tx, y * sy + ty];
  });
}

/** Equirectangular: lon/lat straight into a 360×180 viewBox, y flipped. */
const projX = (lon) => lon + 180;
const projY = (lat) => 90 - lat;

/**
 * One ring → SVG subpaths. Rings crossing the antimeridian (Chukotka, the
 * Aleutians) must be CUT there: consecutive points ~360° apart joined with an
 * `L` draw a filled band across the whole map. Points that round to the same
 * 0.01 grid cell are dropped — sub-pixel detail at card size.
 */
function ringToPath(ring) {
  const subpaths = [];
  let cur = "";
  let prevX = null;
  let prevY = null;
  let prevLon = null;

  const flush = () => {
    if (cur && cur.split(/[ML]/).length > 3) subpaths.push(`${cur}Z`);
    cur = "";
    prevX = null;
    prevY = null;
  };

  for (const [lon, lat] of ring) {
    if (prevLon !== null && Math.abs(lon - prevLon) > 180) flush();
    prevLon = lon;
    const x = Math.round(projX(lon) * 100) / 100;
    const y = Math.round(projY(lat) * 100) / 100;
    if (x === prevX && y === prevY) continue;
    cur += `${cur === "" ? "M" : "L"}${x} ${y}`;
    prevX = x;
    prevY = y;
  }
  flush();
  return subpaths.join("");
}

/** Assemble a ring from arc indexes; ~i traverses arc i backwards, and arcs
 *  share endpoints so the duplicated join point is skipped. */
function arcsToRing(arcIndexes, arcs) {
  const ring = [];
  for (const idx of arcIndexes) {
    const reversed = idx < 0;
    const arc = arcs[reversed ? ~idx : idx];
    const pts = reversed ? [...arc].reverse() : arc;
    ring.push(...(ring.length ? pts.slice(1) : pts));
  }
  return ring;
}

console.log(`Fetching world atlas from ${ATLAS} ...`);
const res = await fetch(ATLAS);
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status}`);
  process.exit(1);
}
const topo = await res.json();
const geometries = topo.objects?.countries?.geometries;
if (!geometries?.length) {
  console.error("Unexpected atlas shape: objects.countries.geometries missing");
  process.exit(1);
}

const arcs = topo.arcs.map((a) => decodeArc(a, topo.transform));
const paths = {};
let skipped = 0;

for (const geom of geometries) {
  const alpha2 = NUMERIC_TO_ALPHA2[Number(geom.id)];
  if (!alpha2) {
    skipped++;
    continue;
  }
  // Polygon = one outer ring (+ holes); MultiPolygon = many. All rings flatten
  // into one path string; fill-rule evenodd renders holes correctly.
  const polygons =
    geom.type === "Polygon" ? [geom.arcs] : geom.type === "MultiPolygon" ? geom.arcs : [];
  let d = "";
  for (const poly of polygons) {
    for (const ringArcs of poly) d += ringToPath(arcsToRing(ringArcs, arcs));
  }
  if (d) paths[alpha2] = (paths[alpha2] ?? "") + d;
}

const out = {
  _source: "world-atlas countries-110m (Natural Earth, public domain)",
  _projection: "equirectangular, viewBox 0 0 360 180",
  _generatedBy: "apps/web/scripts/update-world-map.mjs",
  paths,
};
await writeFile(OUT, JSON.stringify(out));
console.log(
  `Wrote ${Object.keys(paths).length} countries to ${OUT} (${skipped} unmapped ids skipped)`,
);
