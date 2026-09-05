import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Observe preference transitions without forcing an initial callback. */
export function observeReducedMotion(onChange: (reduced: boolean) => void): () => void {
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  const listener = () => onChange(media.matches);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function subscribe(onChange: () => void): () => void {
  return observeReducedMotion(onChange);
}

function clientSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function serverSnapshot(): boolean {
  return false;
}

/** Hydration-safe subscription to the visitor's OS motion preference. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
