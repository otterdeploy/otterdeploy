import type { SVGProps } from "react";

/**
 * Cloud Native Buildpacks brand mark — three stacked diamond cubes
 * with pink / blue / indigo gradients. Ported from
 * github.com/buildpacks/artwork/blob/main/light-background/logo-light.svg.
 *
 * Gradient ids are localised to avoid collisions when multiple
 * instances render on the same page (default id="a/b/c" would clash).
 */
const Buildpacks = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    viewBox="0 0 300 300"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="bp_a" x1="50%" x2="50%" y1="0%" y2="100%">
        <stop offset="0%" stopColor="#FC72C7" />
        <stop offset="100%" stopColor="#DE156C" />
      </linearGradient>
      <linearGradient id="bp_b" x1="50%" x2="50%" y1="0%" y2="100%">
        <stop offset="0%" stopColor="#8896DB" />
        <stop offset="100%" stopColor="#47529D" />
      </linearGradient>
      <linearGradient id="bp_c" x1="50%" x2="50%" y1="0%" y2="100%">
        <stop offset="0%" stopColor="#757CBA" />
        <stop offset="100%" stopColor="#252960" />
      </linearGradient>
    </defs>
    <g fill="none" fillRule="evenodd" transform="translate(88 98)">
      <g transform="translate(64 54)">
        <path
          fill="#DE156C"
          d="M27.998 14.176L6.001 1.467C4.088.362 1.642 1.017.537 2.93.185 3.538 0 4.228 0 4.93v25.428c0 1.428.762 2.748 1.999 3.463l25.999 15.023c1.238.715 2.764.715 4.002 0L58.001 33.82c1.237-.714 1.999-2.034 1.999-3.463V4.93C60 2.721 58.209.93 56 .93c-.703 0-1.393.185-2.001.537L32 14.176c-1.238.715-2.764.715-4.002 0Z"
        />
        <path
          fill="url(#bp_a)"
          d="M30 17.64v25.43c0 2.21 1.79 4 4 4 .702 0 1.393-.186 2.001-.537L58.001 33.82c1.237-.714 1.999-2.034 1.999-3.463V4.93C60 2.721 58.209.93 56 .93c-.703 0-1.393.185-2.001.537L32 14.176c-1.238.715-2 2.035-2 3.464Z"
        />
      </g>
      <g transform="translate(32 0)">
        <path
          fill="#47529D"
          d="M53.999 3.468L32.003 16.178c-1.238.715-2.764.715-4.002 0L6.001 3.467C4.088 2.362 1.642 3.017.537 4.93.185 5.538 0 6.228 0 6.93v25.43c0 1.428.762 2.748 1.999 3.463L28.001 50.844c1.238.715 2.764.715 4.002 0l25.998-15.022c1.237-.714 1.999-2.034 1.999-3.463V6.931C60 4.722 58.209 2.931 56 2.931c-.703 0-1.393.185-2.001.537Z"
        />
        <path
          fill="url(#bp_b)"
          d="M53.999 3.467L31.999 16.179c-1.237.715-2 2.035-2 3.464v25.426c0 2.21 1.791 4 4 4 .703 0 1.393-.186 2.001-.537L58 35.823c1.238-.715 2-2.035 2-3.464V6.931C60 4.722 58.209 2.931 56 2.931c-.703 0-1.393.185-2.001.537Z"
        />
      </g>
      <g transform="translate(0 52)">
        <path
          fill="#252960"
          d="M27.999 16.176L6.001 3.467C4.088 2.362 1.642 3.017.537 4.93.185 5.538 0 6.228 0 6.93v25.428c0 1.428.762 2.748 1.999 3.463L27.999 50.844c1.238.715 2.764.715 4.002 0l25.998-15.022c1.237-.714 1.999-2.034 1.999-3.463V6.931C60 4.722 58.209 2.931 56 2.931c-.703 0-1.393.185-2.001.537L32 16.176c-1.238.715-2.764.715-4.002 0Z"
        />
        <path
          fill="url(#bp_c)"
          d="M30 19.64v25.43c0 2.21 1.79 4 4 4 .702 0 1.393-.186 2.001-.537L58.001 35.82c1.237-.714 1.999-2.034 1.999-3.463V6.93C60 4.722 58.209 2.931 56 2.931c-.703 0-1.393.185-2.001.537L32 16.176c-1.238.715-2 2.035-2 3.464Z"
        />
      </g>
    </g>
  </svg>
);

export { Buildpacks };
