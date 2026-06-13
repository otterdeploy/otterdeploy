/**
 * Direction shim for the vendored data-grid. Upstream used `radix-ui`'s
 * DirectionProvider; this app is LTR-only (components.json rtl:false) and uses
 * Base UI, so this is a no-op provider + an LTR `useDirection`.
 */

import type * as React from "react";

type Direction = "ltr" | "rtl";

function DirectionProvider({
  children,
}: {
  dir?: Direction;
  direction?: Direction;
  children?: React.ReactNode;
}) {
  return <>{children}</>;
}

function useDirection(localDir?: Direction): Direction {
  return localDir ?? "ltr";
}

export { DirectionProvider, useDirection };
