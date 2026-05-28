// Demo icons — ported verbatim from apps/web-demo/src/features/otterdeploy/icons.tsx.
// Renamed to icons-demo to avoid collision with the HugeIcons set used throughout apps/web.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const make = (children: React.ReactNode, opts: { fill?: boolean; sw?: number } = {}) =>
  function Icon(p: IconProps) {
    return (
      <svg
        viewBox="0 0 16 16"
        fill={opts.fill ? "currentColor" : "none"}
        stroke={opts.fill ? undefined : "currentColor"}
        strokeWidth={opts.sw ?? 1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...p}
      >
        {children}
      </svg>
    );
  };

export const I = {
  graph: make(
    <>
      <circle cx="3.5" cy="8" r="1.6" />
      <circle cx="12.5" cy="3.5" r="1.6" />
      <circle cx="12.5" cy="12.5" r="1.6" />
      <path d="M5 7l6-3M5 9l6 3" />
    </>,
  ),
  rocket: make(
    <>
      <path d="M11 2c-3 0-7 4-7 7l2 2c0 0 4 0 7-3s2-6 2-6 0 0-4 0z" />
      <circle cx="10" cy="6" r="1" />
      <path d="M4 12l-1 1m6-1l-2 2" />
    </>,
  ),
  log: make(<path d="M3 4h10M3 8h10M3 12h6" />),
  db: make(
    <>
      <ellipse cx="8" cy="3.5" rx="5" ry="1.7" />
      <path d="M3 3.5v9c0 .9 2.2 1.7 5 1.7s5-.8 5-1.7v-9" />
      <path d="M3 8c0 .9 2.2 1.7 5 1.7s5-.8 5-1.7" />
    </>,
  ),
  globe: make(
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c2 2 2 9 0 11M8 2.5c-2 2-2 9 0 11" />
    </>,
  ),
  env: make(
    <>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
      <path d="M5 7h2M5 9.5h4M9 7h2" />
    </>,
  ),
  metrics: make(<path d="M2.5 12V8M6 12V5M9.5 12V9M13 12V3" />),
  home: make(<path d="M2.5 7.5L8 3l5.5 4.5V13H2.5z" />),
  service: make(
    <>
      <rect x="2.5" y="2.5" width="11" height="4" rx="1" />
      <rect x="2.5" y="9.5" width="11" height="4" rx="1" />
      <circle cx="5" cy="4.5" r="0.4" fill="currentColor" />
      <circle cx="5" cy="11.5" r="0.4" fill="currentColor" />
    </>,
  ),
  plus: make(<path d="M8 3.5v9M3.5 8h9" />, { sw: 1.5 }),
  search: make(
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3 3" />
    </>,
  ),
  chev: make(<path d="M6 4l4 4-4 4" />),
  chevDown: make(<path d="M4 6l4 4 4-4" />),
  close: make(<path d="M4 4l8 8M12 4l-8 8" />),
  github: make(
    <path d="M8 0a8 8 0 0 0-2.5 15.6c.4.07.55-.17.55-.38l-.01-1.4c-2.2.48-2.67-1.05-2.67-1.05-.36-.92-.88-1.16-.88-1.16-.72-.5.05-.48.05-.48.8.06 1.22.82 1.22.82.71 1.2 1.86.86 2.31.66.07-.51.28-.86.5-1.06-1.75-.2-3.6-.88-3.6-3.9 0-.86.31-1.56.81-2.11-.08-.2-.35-1 .08-2.07 0 0 .67-.21 2.2.8a7.6 7.6 0 0 1 4 0c1.53-1.01 2.2-.8 2.2-.8.43 1.07.16 1.87.08 2.07.5.55.81 1.25.81 2.11 0 3.03-1.85 3.7-3.61 3.89.29.24.54.72.54 1.45l-.01 2.15c0 .21.15.46.55.38A8 8 0 0 0 8 0z" />,
    { fill: true },
  ),
  branch: make(
    <>
      <circle cx="4" cy="3.5" r="1.3" />
      <circle cx="4" cy="12.5" r="1.3" />
      <circle cx="12" cy="6" r="1.3" />
      <path d="M4 5v6M4 9c0-2.5 2-3 4-3" />
    </>,
  ),
  cpu: make(
    <>
      <rect x="3.5" y="3.5" width="9" height="9" rx="1" />
      <rect x="6" y="6" width="4" height="4" />
      <path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2" />
    </>,
  ),
  refresh: make(
    <>
      <path d="M2.5 8a5.5 5.5 0 0 1 9.5-3.7M13.5 8a5.5 5.5 0 0 1-9.5 3.7" />
      <path d="M11 2v3h-3M5 14v-3h3" />
    </>,
  ),
  copy: make(
    <>
      <rect x="5" y="5" width="8" height="8" rx="1" />
      <path d="M3 11V4a1 1 0 0 1 1-1h7" />
    </>,
  ),
  eye: make(
    <>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="1.8" />
    </>,
  ),
  more: make(
    <>
      <circle cx="3.5" cy="8" r="1.2" />
      <circle cx="8" cy="8" r="1.2" />
      <circle cx="12.5" cy="8" r="1.2" />
    </>,
    { fill: true },
  ),
  key: make(
    <>
      <circle cx="5" cy="11" r="2.5" />
      <path d="M6.8 9.2l5.7-5.7M10 6l1.5 1.5M12 4.5L13.5 6" />
    </>,
  ),
  lock: make(
    <>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" />
    </>,
  ),
  sync: make(
    <>
      <path d="M2.5 8a5.5 5.5 0 0 1 9.5-3.7L13.5 5.5" />
      <path d="M11 5.5h2.5V3" />
      <path d="M13.5 8a5.5 5.5 0 0 1-9.5 3.7L2.5 10.5" />
      <path d="M5 10.5H2.5V13" />
    </>,
  ),
  settings: make(
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </>,
  ),
  user: make(
    <>
      <circle cx="8" cy="6" r="2.5" />
      <path d="M3 13.5c.7-2.2 2.7-3.5 5-3.5s4.3 1.3 5 3.5" />
    </>,
  ),
  users: make(
    <>
      <circle cx="6" cy="6" r="2.2" />
      <path d="M2 13c.5-1.8 2.1-3 4-3s3.5 1.2 4 3" />
      <circle cx="11.5" cy="5.5" r="1.7" />
      <path d="M10.5 9.5c2.4-.3 3.5 1 4 3.5" />
    </>,
  ),
  check: make(<path d="M3 8.5l3 3 7-7" />, { sw: 1.6 }),
  x: make(<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />, { sw: 1.6 }),
  circle: make(<circle cx="8" cy="8" r="3.5" />, { sw: 1.5 }),
  upload: make(<path d="M8 11V3M5 6l3-3 3 3M3 13h10" />),
  download: make(<path d="M8 3v8M5 8l3 3 3-3M3 13h10" />),
  doc: make(
    <>
      <path d="M4 2h5l3 3v9H4z" />
      <path d="M9 2v3h3" />
    </>,
  ),
  folder: make(<path d="M2.5 4.5h4l1.5 1.5h5.5v7H2.5z" />),
  server: make(
    <>
      <rect x="2.5" y="2.5" width="11" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="11" height="4.5" rx="1" />
      <circle cx="5" cy="4.7" r="0.5" fill="currentColor" />
      <circle cx="5" cy="11.2" r="0.5" fill="currentColor" />
    </>,
  ),
  edit: make(
    <>
      <path d="M2.5 13.5h2L13 5l-2-2L2.5 11.5z" />
      <path d="M9 5l2 2" />
    </>,
  ),
  trash: make(<path d="M3 4.5h10M6 4.5V3h4v1.5M5 4.5v8.5h6V4.5" />),
  warning: make(
    <>
      <path d="M8 2.5l6 11H2z" />
      <path d="M8 7v3" />
      <circle cx="8" cy="11.8" r="0.5" fill="currentColor" />
    </>,
  ),
  bolt: make(<path d="M9 2L3.5 9.5h3L7 14l5.5-7.5h-3z" />),
  scale: make(
    <>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </>,
  ),
  link: make(<path d="M7 9.5l2-3M6 5l1.5-1.5a2.8 2.8 0 0 1 4 4L10 9M10 6.5L8.5 8a2.8 2.8 0 0 1-4-4L6 2.5" />),
  filter: make(<path d="M2.5 3.5h11L9.5 9v3.5L6.5 14V9z" />),
  logout: make(
    <>
      <path d="M9.5 4.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h5.5a1 1 0 0 0 1-1v-1.5" />
      <path d="M6 8h8M11 5l3 3-3 3" />
    </>,
  ),
  clock: make(
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.5V8l2.5 1.5" />
    </>,
  ),
} as const;

export type IconKey = keyof typeof I;
