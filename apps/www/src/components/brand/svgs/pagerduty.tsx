import type { SVGProps } from "react";

/**
 * PagerDuty mark (Simple Icons path). Brand green reads on both the light
 * and dark canvas.
 */
const Pagerduty = (props: SVGProps<SVGSVGElement>) => (
  <svg {...props} role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#06AC38">
    <title>PagerDuty</title>
    <path d="M16.965 1.18C15.085.164 13.769 0 10.683 0H3.73v14.55h6.926c2.743 0 4.8-.164 6.61-1.37 1.975-1.303 3.004-3.484 3.004-6.007 0-2.716-1.262-4.896-3.305-5.994zm-5.5 10.326h-4.69V3.086l4.415-.027c4.03-.027 6.062 1.372 6.062 4.196 0 3.032-2.195 4.251-5.787 4.251zM3.73 17.61h3.045V24H3.73z" />
  </svg>
);

export { Pagerduty };
