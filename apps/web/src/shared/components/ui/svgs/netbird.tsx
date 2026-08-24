import type { SVGProps } from "react";

/**
 * NetBird mark, taken from the official art on netbird.io (netbird-icon.svg).
 * Monochrome, so it inherits the text colour and stays legible on both
 * canvases: the brand orange would read as an accent here, and the accent is
 * spoken for (see DESIGN.md).
 *
 * The source art is two-tone — two `#F68330` wings with a darker `#F35E32`
 * fold where they cross. Flattening everything to one colour loses the fold,
 * so the hierarchy is kept as opacity instead: the wings sit back and the fold
 * is drawn at full weight over them. That holds the silhouette's depth at 16px.
 */
const NetBird = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    role="img"
    viewBox="0 0 41 30"
    xmlns="http://www.w3.org/2000/svg"
    fill="currentColor"
  >
    <title>NetBird</title>
    <g opacity="0.55">
      <path d="M28.5735 0C23.7203 0.445248 21.3049 3.23918 20.3921 4.65284L6.21094 29.2194H23.3196L40.1945 0H28.5735Z" />
      <path d="M23.331 29.2198L0 4.47517C0 4.47517 26.381 -2.6154 28.9523 19.5023L23.331 29.2198Z" />
    </g>
    <path d="M19.8683 5.56728L12.7109 17.9674L23.319 29.2211L28.9402 19.4813C28.0497 11.8787 24.343 7.72674 19.8683 5.55615" />
  </svg>
);

export { NetBird };
