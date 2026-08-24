import type { SVGProps } from "react";

/**
 * Healthchecks mark (dashboard-icons). Colours are the brand's own.
 */
const Healthchecks = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    role="img"
    viewBox="46.6 2.94 418.8 506.2"
    xmlns="http://www.w3.org/2000/svg"
    xmlSpace="preserve"
  >
    <title>Healthchecks</title>
    <path
      d="M309.2 899.8h-45.3l41.4 246.7h46.1l24-142.8h70.1l4.9-46.7H335.9l-7.5 44.6z"
      style={{
        fillRule: "evenodd",
        clipRule: "evenodd",
        fill: "#22bc66",
        stroke: "#22bc66",
        strokeWidth: "30",
      }}
      transform="translate(0 -652.362)"
    />
    <path
      d="m218.9 670.3-47.6 283.1H68.6l-7 46.7h74.3l14.4 85.9h46.1l20.7-115.8 22.8-135.4 52.7-.1L265 670.3z"
      style={{
        fillRule: "evenodd",
        clipRule: "evenodd",
        fill: "#ffffff",
        stroke: "#ffffff",
        strokeWidth: "30",
      }}
      transform="translate(0 -652.362)"
    />
  </svg>
);

export { Healthchecks };
