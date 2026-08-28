import type { SVGProps } from "react";

/**
 * Buzz mark (dashboard-icons), as a themed pair.
 *
 * The upstream asset flips its ink on `prefers-color-scheme`, which only tracks
 * the OS; this app has an explicit theme toggle, so the two inks ship as
 * separate components and `svgl-logo.tsx` picks one.
 *
 * The two used to be a file each, identical but for the component name, the
 * mask id and one fill — a clone group the audit ratchet flagged. The geometry
 * lives once here and the ink is a parameter. The mask id is derived from the
 * variant because two instances on one page would otherwise share an id, and
 * the second `mask="url(#…)"` would resolve to the first one's mask.
 */
const BuzzMark = ({ ink, variant, ...props }: BuzzMarkProps) => {
  const maskId = `buzz-${variant}-bee`;
  return (
    <svg {...props} role="img" viewBox="0 0 466 309" xmlns="http://www.w3.org/2000/svg">
      <title>Buzz</title>
      <mask id={maskId}>
        <circle cx="91.7" cy="154.5" r="91.7" fill="white" />
        <circle cx="374.3" cy="154.5" r="91.7" fill="white" />
        <rect x="128" y="0" width="210" height="309" rx="34" fill="white" />
        <circle cx="193.3" cy="84.4" r="27" fill="black" />
        <circle cx="276" cy="84.4" r="27" fill="black" />
        <rect x="166.3" y="157.2" width="136.9" height="38.3" rx="5" fill="black" />
        <rect x="166.9" y="235.1" width="136.2" height="37.6" rx="5" fill="black" />
      </mask>
      <rect width="466" height="309" fill={ink} mask={`url(#${maskId})`} />
    </svg>
  );
};

interface BuzzMarkProps extends SVGProps<SVGSVGElement> {
  ink: string;
  variant: "dark" | "light";
}

const BuzzDark = (props: SVGProps<SVGSVGElement>) => (
  <BuzzMark {...props} ink="#d7d72e" variant="dark" />
);

const BuzzLight = (props: SVGProps<SVGSVGElement>) => (
  <BuzzMark {...props} ink="#231e1e" variant="light" />
);

export { BuzzDark, BuzzLight };
