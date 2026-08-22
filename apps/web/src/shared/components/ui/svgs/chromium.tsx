import type { SVGProps } from "react";

/**
 * Chromium mark (SVGL). Colours are the brand's own.
 */
const Chromium = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    role="img"
    viewBox="0 0 512 512"
    xmlns="http://www.w3.org/2000/svg"
    xmlSpace="preserve"
  >
    <title>Chromium</title>
    <linearGradient
      id="chromium-a"
      x1="65.597"
      x2="65.452"
      y1="582.504"
      y2="480.818"
      gradientTransform="matrix(3.7794 0 0 -3.7794 136.172 2328.992)"
      gradientUnits="userSpaceOnUse"
    >
      <stop offset="0" style={{ stopColor: "#afccfb" }} />
      <stop offset="1" style={{ stopColor: "#8bb5f8" }} />
    </linearGradient>
    <path
      d="m256 256 110.9 64L256 512c141.4 0 256-114.6 256-256 0-46.6-12.5-90.3-34.3-128H256z"
      style={{ fill: "url(#chromium-a)" }}
    />
    <linearGradient
      id="chromium-b"
      x1="-48.189"
      x2="-48.097"
      y1="653.089"
      y2="651.604"
      gradientTransform="matrix(231.6257 0 0 -231.6247 11410.03 151273.703)"
      gradientUnits="userSpaceOnUse"
    >
      <stop offset="0" style={{ stopColor: "#1972e7" }} />
      <stop offset="1" style={{ stopColor: "#1969d5" }} />
    </linearGradient>
    <path
      d="M256 0C161.2 0 78.6 51.5 34.3 128l110.8 192L256 256V128h221.7C433.4 51.5 350.7 0 256 0"
      style={{ fill: "url(#chromium-b)" }}
    />
    <linearGradient
      id="chromium-c"
      x1="-48.211"
      x2="-46.46"
      y1="653.377"
      y2="652.365"
      gradientTransform="matrix(94.9316 164.4269 164.4276 -94.9311 -102672.969 70081.04)"
      gradientUnits="userSpaceOnUse"
    >
      <stop offset="0" style={{ stopColor: "#659cf6" }} />
      <stop offset="1" style={{ stopColor: "#4285f4" }} />
    </linearGradient>
    <path
      d="M0 256c0 141.4 114.6 256 256 256l110.9-192L256 256l-110.9 64L34.3 128C12.5 165.7 0 209.4 0 256"
      style={{ fill: "url(#chromium-c)" }}
    />
    <path
      d="M384 256c0 70.7-57.3 128-128 128s-128-57.3-128-128 57.3-128 128-128 128 57.3 128 128"
      style={{ fill: "#fff" }}
    />
    <linearGradient
      id="chromium-d"
      x1="31.565"
      x2="31.846"
      y1="575.91"
      y2="520.979"
      gradientTransform="matrix(3.7794 0 0 -3.7794 136.172 2328.992)"
      gradientUnits="userSpaceOnUse"
    >
      <stop offset="0" style={{ stopColor: "#3680f0" }} />
      <stop offset="1" style={{ stopColor: "#2678ec" }} />
    </linearGradient>
    <path
      d="M360 256c0 57.4-46.6 104-104 104s-104-46.6-104-104 46.6-104 104-104 104 46.6 104 104"
      style={{ fill: "url(#chromium-d)" }}
    />
  </svg>
);

export { Chromium };
