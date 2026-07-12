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
      d="M3 0C1.34315 0 0 1.34315 0 3V21C0 22.6569 1.34315 24 3 24H21C22.6569 24 24 22.6569 24 21V3C24 1.34315 22.6569 0 21 0H3ZM3.63333 2.13333C2.8049 2.13333 2.13333 2.8049 2.13333 3.63333V20.3667C2.13333 21.1951 2.8049 21.8667 3.63333 21.8667H20.3667C21.1951 21.8667 21.8667 21.1951 21.8667 20.3667V3.63333C21.8667 2.8049 21.1951 2.13333 20.3667 2.13333H3.63333Z"
    />
  </svg>
);

export { Nocodb };
