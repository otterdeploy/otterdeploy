import type { SVGProps } from "react";

/**
 * NetBird mark. Monochrome, so it inherits the text color and stays legible on
 * both canvases: the brand orange would read as an accent here, and the accent
 * is spoken for (see DESIGN.md).
 *
 * The source art is two-tone (a lighter body over a darker inner wing). Flattening
 * both to one colour loses the fold entirely, so the inner shape keeps a reduced
 * opacity instead: that preserves the silhouette's depth at 16px.
 */
const NetBird = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    role="img"
    viewBox="0.02 69.9 512 372.2"
    xmlns="http://www.w3.org/2000/svg"
    fill="currentColor"
  >
    <title>NetBird</title>
    <g transform="translate(-.385 1.9)">
      <path d="M364.3 68c-61.8 5.7-92.5 41.3-104.1 59.3l-5.2 9.1c-.4.8-.6 1.3-.6 1.3l-.1-.1L79.5 440.2h218L512.4 68z" />
      <path d="M297.5 440.2.4 125s336-90.2 368.7 191.4z" />
      <path
        d="m253.5 138.9-91.2 157.9 135.2 143.4 71.6-124c-11.3-96.9-58.5-149.7-115.6-177.3"
        opacity="0.55"
      />
    </g>
  </svg>
);

export { NetBird };
