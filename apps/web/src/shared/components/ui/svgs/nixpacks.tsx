import type { SVGProps } from "react";

/**
 * Nixpacks brand mark — the isometric tan-brown box from
 * github.com/railwayapp/nixpacks/blob/main/docs/public/box.svg.
 */
const Nixpacks = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    viewBox="0 0 402 451"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M205.3 225.469L0 106.857L0 319.5L205.3 450.805V225.469Z"
      fill="#B3926F"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M205.3 0L400.448 112.735L205.3 225.469L85.2188 156.145L0 106.857L205.3 0Z"
      fill="#D0B08E"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M401.002 337.751L400.502 112.596L205.002 225.04V450.329L206.209 450.596L401.002 337.751Z"
      fill="#947451"
    />
  </svg>
);

export { Nixpacks };
