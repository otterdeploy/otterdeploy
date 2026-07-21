import type { SVGProps } from "react";

/**
 * Hono's official brand mark — a flame ("hono" = flame in Japanese). simple-icons
 * ships no Hono SVG, so this is the logo straight from hono.dev: the two-tone
 * orange flame with its gradient, rather than a `currentColor` silhouette. Its
 * fills are self-contained (gradient + solid), so it renders correct brand
 * colours on any tile regardless of the surrounding text colour.
 */
const Hono = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    role="img"
    viewBox="0 0 76 98"
    xmlns="http://www.w3.org/2000/svg"
  >
    <title>Hono</title>
    <path
      fill="url(#hono-flame-gradient)"
      d="m11 25 7 9s9-18 22-34c17 20 36 48 36 64 0 20-19 34-37 34C17 98 0 81 0 61c0-6 3-24 11-36Z"
    />
    <path fill="#F95" d="M39 21c47 51 14 66 0 66-11 0-51-11 0-66Z" />
    <defs>
      <linearGradient id="hono-flame-gradient" x2="0%" y2="100%">
        <stop stopColor="#F84" />
        <stop offset="100%" stopColor="#F30" />
      </linearGradient>
    </defs>
  </svg>
);

export { Hono };
