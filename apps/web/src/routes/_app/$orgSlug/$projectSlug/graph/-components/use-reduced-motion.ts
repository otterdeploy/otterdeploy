/**
 * `prefers-reduced-motion` as reactive state — gates the traffic edges'
 * marching-dash animation (they fall back to a static dash pattern).
 * Same matchMedia-subscription idiom as shared/hooks/use-mobile.
 */

import { useEffect, useState } from "react";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
