import type { SVGProps } from "react";

/**
 * ClickHouse mark (dashboard-icons). Colours are the brand's own.
 */
const ClickHouse = (props: SVGProps<SVGSVGElement>) => (
  <svg {...props} role="img" viewBox="0 28.4 512 455.2" xmlns="http://www.w3.org/2000/svg">
    <title>ClickHouse</title>
    <path d="M0 426.7h56.9v56.9H0z" style={{ fill: "red" }} />
    <path
      d="M0 28.4h56.9v398.2H0zm113.8 0h56.9v455.1h-56.9zm113.8 0h56.9v455.1h-56.9zm113.7 0h56.9v455.1h-56.9zm113.8 184.9H512v85.3h-56.9z"
      style={{ fill: "#fc0" }}
    />
  </svg>
);

export { ClickHouse };
