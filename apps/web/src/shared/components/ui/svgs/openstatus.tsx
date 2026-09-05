import type { SVGProps } from "react";

/**
 * openstatus mark, taken from the project's own repo
 * (`apps/web/public/assets/logos/OpenStatus-Logo.svg`): a filled disc with two
 * offset bars knocked out of it.
 *
 * Upstream ships it as a black disc with white bars, which disappears on the
 * dark canvas. The geometry is a single ink, so it paints with `currentColor`
 * through a mask instead of a themed pair, and inherits the tile's own ink.
 */
const OpenStatus = (props: SVGProps<SVGSVGElement>) => (
  <svg {...props} role="img" viewBox="0 0 330 330" xmlns="http://www.w3.org/2000/svg">
    <title>openstatus</title>
    <mask id="openstatus-mark">
      <circle cx="165" cy="165" r="165" fill="white" />
      <rect x="122" y="96" width="208" height="15" fill="black" />
      <rect x="0" y="219" width="208" height="15" fill="black" />
    </mask>
    <rect width="330" height="330" fill="currentColor" mask="url(#openstatus-mark)" />
  </svg>
);

export { OpenStatus };
