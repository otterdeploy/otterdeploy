import * as React from "react";

/**
 * Track an element's pixel height via ResizeObserver. The grid virtualizer
 * needs a concrete height; wire the returned ref to the container.
 */
export function useElementHeight<T extends HTMLElement = HTMLDivElement>(
  fallback = 520,
): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T>(null);
  const [height, setHeight] = React.useState(fallback);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setHeight(el.clientHeight || fallback);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);

  return [ref, height];
}
