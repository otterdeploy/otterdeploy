/**
 * otterdeploy logo mark concepts.
 *
 * Every mark is authored on a 32x32 grid so it can be dropped straight into a
 * favicon without re-fitting. Ink is `currentColor` (so the mark inherits the
 * surface's foreground and stays theme-symmetric); the single Signal Blue is
 * `var(--brand-accent)` per DESIGN.md's One Voice Rule, one accent, nothing
 * else chromatic.
 */

/** Rounded-square ring shared by the marks that read as an "o". */
const RING = 'x="4.6" y="4.6" width="22.8" height="22.8" rx="7.1"';

export const marks = {
  "slashed-zero": {
    name: "Slashed Zero",
    tagline: "The mono glyph that names the craft",
    rationale:
      "DESIGN.md calls out the slashed zero by name: `0` and `O` must never blur. This mark is that glyph: the rounded-square ring is otterdeploy's own `rounded-lg` node shape, the slash is Signal Blue. It reads simultaneously as the 'o' of otterdeploy, a zero, and a card/node.",
    svg: `
      <rect ${RING} fill="none" stroke="currentColor" stroke-width="2.6"/>
      <path d="M11.6 20.4 20.4 11.6" fill="none" stroke="var(--brand-accent)" stroke-width="2.6" stroke-linecap="round"/>`,
  },

  "comet-ring": {
    name: "Comet Ring",
    tagline: "The pending state, frozen",
    rationale:
      "Lifted from the signature component: the comet border that travels a node's ring while a deploy is pending. The mark is that instant held still. A quiet ink ring with one bright segment of light on it. It is literally the product's most distinctive moment.",
    svg: `
      <rect ${RING} fill="none" stroke="currentColor" stroke-opacity="0.22" stroke-width="2.6"/>
      <rect ${RING} fill="none" stroke="var(--brand-accent)" stroke-width="2.6" stroke-linecap="round"
            pathLength="100" stroke-dasharray="27 73" stroke-dashoffset="-4"/>`,
  },

  "node-edge": {
    name: "Node & Edge",
    tagline: "The project graph, reduced to two",
    rationale:
      "The React Flow project graph is otterdeploy's signature surface. Two nodes and the orthogonal edge between them are the smallest true statement of it: source builds, target runs. The target node carries the blue. The thing that just came up.",
    svg: `
      <rect x="4.2" y="4.2" width="10" height="10" rx="3.2" fill="none" stroke="currentColor" stroke-width="2.2"/>
      <path d="M9.2 15.6v5.2a2.4 2.4 0 0 0 2.4 2.4h4.4" fill="none" stroke="currentColor"
            stroke-opacity="0.4" stroke-width="2.2" stroke-linecap="round"/>
      <rect x="17.8" y="17.8" width="10" height="10" rx="3.2" fill="var(--brand-accent)"/>`,
  },

  aperture: {
    name: "Aperture",
    tagline: "Ship up, out of the tile",
    rationale:
      "The one solid-fill mark in the set: an ink tile with the deploy caret knocked out of it, so the chevron is made of whatever surface it sits on. Highest contrast of the five and the most legible at 16px, at the cost of being the least otterdeploy-specific.",
    svg: `
      <path fill="currentColor" fill-rule="evenodd" d="
        M9.4 3.2h13.2a6.2 6.2 0 0 1 6.2 6.2v13.2a6.2 6.2 0 0 1-6.2 6.2H9.4a6.2 6.2 0 0 1-6.2-6.2V9.4a6.2 6.2 0 0 1 6.2-6.2Z
        M10.9 20.2a1.4 1.4 0 0 0 2.1 1.85l3-3.4 3 3.4a1.4 1.4 0 0 0 2.1-1.85l-4.05-4.6a1.4 1.4 0 0 0-2.1 0Z"/>
      <circle cx="16" cy="24.3" r="1.55" fill="var(--brand-accent)"/>`,
  },

  otter: {
    name: "Otter",
    tagline: "Say the name out loud",
    rationale:
      "The only mark with recall value at a glance: a reduced otter head, ears set wide and high, flat muzzle, blue nose. Warmer than the rest of the set, which is the risk: the brand register is 'calm, confident infrastructure', not consumer-playful. Works if the product wants a face.",
    svg: `
      <circle cx="8.3" cy="9.7" r="3.05" fill="currentColor"/>
      <circle cx="23.7" cy="9.7" r="3.05" fill="currentColor"/>
      <path fill="currentColor" fill-rule="evenodd" d="
        M16 7a9.4 9.2 0 1 0 0 18.4A9.4 9.2 0 0 0 16 7Z
        M12.55 15.15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z
        M19.45 15.15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z
        M16 18.3a3.7 2.95 0 1 0 0 5.9 3.7 2.95 0 0 0 0-5.9Z"/>
      <circle cx="16" cy="20.1" r="1.5" fill="var(--brand-accent)"/>`,
  },
};

/** Renders a mark at `size` px. Ink follows `currentColor` from the caller. */
export function renderMark(id, size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none"
    xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${marks[id].name} mark"
    >${marks[id].svg}</svg>`;
}
