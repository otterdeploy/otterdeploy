import type { SVGProps } from "react";

/**
 * NetBird mark (dashboard-icons). Colours are the brand's own.
 *
 * The upstream file paints its paths through a `<style>` block with a `.st0`
 * class. That is a global selector once inlined into the page, so a second
 * icon shipping the same generated class name would repaint this one — the
 * fills are set per-path here instead.
 */
const Netbird = (props: SVGProps<SVGSVGElement>) => (
  <svg {...props} role="img" viewBox="0.02 69.9 512 372.2" xmlns="http://www.w3.org/2000/svg">
    <title>NetBird</title>
    <g transform="translate(-.385 1.9)">
      <path
        fill="#f68330"
        d="M364.3 68c-61.8 5.7-92.5 41.3-104.1 59.3l-5.2 9.1c-.4.8-.6 1.3-.6 1.3l-.1-.1L79.5 440.2h218L512.4 68z"
      />
      <path fill="#f68330" d="M297.5 440.2.4 125s336-90.2 368.7 191.4z" />
      <path
        fill="#f35e32"
        d="m253.5 138.9-91.2 157.9 135.2 143.4 71.6-124c-11.3-96.9-58.5-149.7-115.6-177.3"
      />
    </g>
  </svg>
);

export { Netbird };
