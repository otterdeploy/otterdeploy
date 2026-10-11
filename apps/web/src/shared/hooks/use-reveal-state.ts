/**
 * Revealed state for a masked value that survives nothing: it is per mount
 * (so any route or tab change masks it again), and a hidden browser tab puts
 * it back to `masked`. Shared by SensitiveValue and SensitiveInput.
 */
import { useEffect, useState } from "react";

export function useRevealState<T>(masked: T) {
  const [state, setState] = useState<T>(masked);
  useEffect(() => {
    if (state === masked) return;
    const onVisibility = () => {
      if (document.hidden) setState(masked);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [state, masked]);
  return [state, setState] as const;
}
