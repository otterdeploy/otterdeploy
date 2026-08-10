import { useEffect, useState } from "react";

/**
 * Trailing-edge debounce over a value. The input stays instant; whatever the
 * returned value keys (a query, a parse, a registry lookup) waits a beat so
 * a keystroke doesn't become a request.
 *
 * Debounce the *value*, not the handler: the visible field and the work it
 * triggers stay separately observable, which is what makes "typing" and
 * "querying" distinguishable states in the UI.
 *
 *   const debouncedQuery = useDebouncedValue(query, 250);
 *   useQuery({ ..., enabled: debouncedQuery.length > 0 });
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
