import type { SVGProps } from "react";

/**
 * Tailscale mark, taken from the official art on tailscale.com (the nav mark:
 * 3×3 dot grid, the "T" — middle row plus bottom centre — solid and the other
 * five dots at 0.4). The brand ships it as `currentColor`, so it inherits the
 * text colour and stays legible on both canvases without spending the accent
 * (see DESIGN.md).
 */
const Tailscale = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    role="img"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    fill="currentColor"
  >
    <title>Tailscale</title>
    {/* The "T": middle row + bottom centre, at full weight. */}
    <path d="M3 15C4.65685 15 6 13.6569 6 12C6 10.3431 4.65685 9 3 9C1.34315 9 0 10.3431 0 12C0 13.6569 1.34315 15 3 15Z" />
    <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" />
    <path d="M21 15C22.6569 15 24 13.6569 24 12C24 10.3431 22.6569 9 21 9C19.3431 9 18 10.3431 18 12C18 13.6569 19.3431 15 21 15Z" />
    <path d="M12 24C13.6569 24 15 22.6569 15 21C15 19.3431 13.6569 18 12 18C10.3431 18 9 19.3431 9 21C9 22.6569 10.3431 24 12 24Z" />
    {/* The remaining grid, held back so the "T" reads first. */}
    <g opacity="0.4">
      <path d="M3 6C4.65685 6 6 4.65685 6 3C6 1.34315 4.65685 0 3 0C1.34315 0 0 1.34315 0 3C0 4.65685 1.34315 6 3 6Z" />
      <path d="M12 6C13.6569 6 15 4.65685 15 3C15 1.34315 13.6569 0 12 0C10.3431 0 9 1.34315 9 3C9 4.65685 10.3431 6 12 6Z" />
      <path d="M21 6C22.6569 6 24 4.65685 24 3C24 1.34315 22.6569 0 21 0C19.3431 0 18 1.34315 18 3C18 4.65685 19.3431 6 21 6Z" />
      <path d="M3 24C4.65685 24 6 22.6569 6 21C6 19.3431 4.65685 18 3 18C1.34315 18 0 19.3431 0 21C0 22.6569 1.34315 24 3 24Z" />
      <path d="M21 24C22.6569 24 24 22.6569 24 21C24 19.3431 22.6569 18 21 18C19.3431 18 18 19.3431 18 21C18 22.6569 19.3431 24 21 24Z" />
    </g>
  </svg>
);

export { Tailscale };
