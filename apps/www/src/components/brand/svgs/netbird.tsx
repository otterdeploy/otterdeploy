import type { SVGProps } from "react";

/**
 * NetBird mark, taken from the official art on netbird.io (netbird-icon.svg).
 *
 * Full brand colour, like the other 95 marks in this directory. The handful
 * that render in `currentColor` (GitHub, Ghost, Tailscale, …) do so because
 * those brands ARE monochrome; NetBird's is not, and rendering it grey next to
 * a gallery of coloured tiles read as a broken logo rather than a restrained
 * one. DESIGN.md's accent budget governs otterdeploy's own chrome, not a
 * third-party mark identifying someone else's product.
 *
 * Two-tone by construction: two `#F68330` wings with a darker `#F35E32` fold
 * where they cross. Drawing the fold over the wings is what holds the
 * silhouette's depth at 16px.
 */
const NetBird = (props: SVGProps<SVGSVGElement>) => (
  <svg {...props} role="img" viewBox="0 0 41 30" xmlns="http://www.w3.org/2000/svg">
    <title>NetBird</title>
    <g fill="#F68330">
      <path d="M28.5735 0C23.7203 0.445248 21.3049 3.23918 20.3921 4.65284L6.21094 29.2194H23.3196L40.1945 0H28.5735Z" />
      <path d="M23.331 29.2198L0 4.47517C0 4.47517 26.381 -2.6154 28.9523 19.5023L23.331 29.2198Z" />
    </g>
    <path
      fill="#F35E32"
      d="M19.8683 5.56728L12.7109 17.9674L23.319 29.2211L28.9402 19.4813C28.0497 11.8787 24.343 7.72674 19.8683 5.55615"
    />
  </svg>
);

export { NetBird };
