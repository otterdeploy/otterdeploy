/**
 * Deterministic anonymous identity for a visitor hash: "Amber Heron" plus a
 * stable hue off the categorical wheel. Derived, never stored — the same
 * visitorId always renders the same name and dot on every screen, and a new
 * daily hash gets a fresh identity, which is the privacy model working.
 */

const ADJECTIVES = [
  "Amber",
  "Brisk",
  "Calm",
  "Candid",
  "Cedar",
  "Clever",
  "Coral",
  "Crisp",
  "Dapper",
  "Deft",
  "Dusky",
  "Eager",
  "Fabled",
  "Fleet",
  "Gentle",
  "Gilded",
  "Hardy",
  "Hazel",
  "Humble",
  "Indigo",
  "Jolly",
  "Keen",
  "Limber",
  "Lively",
  "Lucid",
  "Mellow",
  "Nimble",
  "Noble",
  "Olive",
  "Placid",
  "Plucky",
  "Quiet",
  "Rustic",
  "Sage",
  "Sleek",
  "Spry",
  "Steady",
  "Sunny",
  "Tidy",
  "Witty",
] as const;

const ANIMALS = [
  "Badger",
  "Bison",
  "Bobcat",
  "Crane",
  "Falcon",
  "Fawn",
  "Finch",
  "Fox",
  "Gazelle",
  "Gecko",
  "Heron",
  "Ibex",
  "Jackdaw",
  "Kestrel",
  "Kingfisher",
  "Lark",
  "Lemur",
  "Lynx",
  "Marmot",
  "Marten",
  "Merlin",
  "Mole",
  "Moose",
  "Narwhal",
  "Ocelot",
  "Osprey",
  "Otter",
  "Petrel",
  "Pika",
  "Plover",
  "Puffin",
  "Quail",
  "Raven",
  "Seal",
  "Shrew",
  "Stoat",
  "Swift",
  "Tern",
  "Vole",
  "Wren",
] as const;

/** FNV-1a, 32-bit: tiny, well distributed, and stable across sessions. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Unsigned so the modular picks below never see a negative.
  return hash >>> 0;
}

export interface VisitorIdentity {
  name: string;
  /** Degrees on the categorical wheel; paint with the theme's series S/L. */
  hue: number;
}

/** Same wheel origin as chart-series.ts so visitor dots and series colours
 *  speak one colour language. */
const HUE_ORIGIN = 210;
const HUE_SLOTS = 20;

export function visitorIdentity(visitorId: string): VisitorIdentity {
  const hash = fnv1a(visitorId);
  const adjective = ADJECTIVES[hash % ADJECTIVES.length];
  // Independent draws: reuse of the same bits would couple the two lists and
  // halve the effective name space.
  const animal = ANIMALS[Math.floor(hash / ADJECTIVES.length) % ANIMALS.length];
  const slot = Math.floor(hash / (ADJECTIVES.length * ANIMALS.length)) % HUE_SLOTS;
  return {
    name: `${adjective} ${animal}`,
    hue: (HUE_ORIGIN + (slot * 360) / HUE_SLOTS) % 360,
  };
}

/** CSS paint for the identicon dot; loudness stays theme-owned. */
export function visitorDotColor(hue: number): string {
  return `hsl(${hue.toFixed(1)} var(--chart-series-s) var(--chart-series-l))`;
}
