import type { SVGProps } from "react";

/**
 * Buzz mark, light variant (dashboard-icons). The upstream asset flips its ink
 * on `prefers-color-scheme`, which only tracks the OS; this app has an explicit
 * theme toggle, so the two inks ship as a themed pair instead.
 */
const BuzzLight = (props: SVGProps<SVGSVGElement>) => (
  <svg {...props} role="img" viewBox="0 0 466 309" xmlns="http://www.w3.org/2000/svg">
    <title>Buzz</title>
    <mask id="buzz-light-bee">
      <circle cx="91.7" cy="154.5" r="91.7" fill="white" />
      <circle cx="374.3" cy="154.5" r="91.7" fill="white" />
      <rect x="128" y="0" width="210" height="309" rx="34" fill="white" />
      <circle cx="193.3" cy="84.4" r="27" fill="black" />
      <circle cx="276" cy="84.4" r="27" fill="black" />
      <rect x="166.3" y="157.2" width="136.9" height="38.3" rx="5" fill="black" />
      <rect x="166.9" y="235.1" width="136.2" height="37.6" rx="5" fill="black" />
    </mask>
    <rect width="466" height="309" fill="#231e1e" mask="url(#buzz-light-bee)" />
  </svg>
);

export { BuzzLight };
