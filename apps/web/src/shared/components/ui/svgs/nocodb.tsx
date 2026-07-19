import type { SVGProps } from "react";

/**
 * NocoDB mark (official nocodb/nocodb repo). Rendered in the brand color #4351E8.
 */
const Nocodb = (props: SVGProps<SVGSVGElement>) => (
  <svg {...props} role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#4351E8">
    <title>NocoDB</title>
    <path d="M6 10.87L8.75 13.62V17.98H6V10.87ZM17.56 5.01V17.54C17.56 17.79 17.35 18 17.1 18C16.97 18 16.86 17.95 16.77 17.86L6 8.15V5.41C6 5.15 6.21 4.94 6.47 4.94H6.49C6.61 4.94 6.73 4.99 6.82 5.08L14.81 12.01V5.01H17.56Z" />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M3 0C1.34 0 0 1.34 0 3V21C0 22.66 1.34 24 3 24H21C22.66 24 24 22.66 24 21V3C24 1.34 22.66 0 21 0H3ZM3.63 2.13C2.8 2.13 2.13 2.8 2.13 3.63V20.37C2.13 21.2 2.8 21.87 3.63 21.87H20.37C21.2 21.87 21.87 21.2 21.87 20.37V3.63C21.87 2.8 21.2 2.13 20.37 2.13H3.63Z"
    />
  </svg>
);

export { Nocodb };
