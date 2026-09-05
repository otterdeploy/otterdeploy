import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function clientSnapshot(): boolean {
  return !document.hidden;
}

function serverSnapshot(): boolean {
  return true;
}

/** Hydration-safe subscription to the current document's visibility. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
