/**
 * Direction shim for the vendored data-grid. Upstream used `radix-ui`'s
 * DirectionProvider; this app is LTR-only (components.json rtl:false) and uses
 * Base UI, so this is a no-op provider + an LTR `useDirection`.
 */

type Direction = "ltr" | "rtl";

function useDirection(localDir?: Direction): Direction {
  return localDir ?? "ltr";
}

export { useDirection };
