import * as React from "react";

function useLazyRef<T>(fn: () => T): React.RefObject<T> {
  // Holds a fully-initialized RefObject<T> rather than `T | null`, so the
  // returned ref needs no assertion: the inner object is created (once) with
  // its value already present.
  const holder = React.useRef<React.RefObject<T> | null>(null);
  if (holder.current === null) {
    holder.current = { current: fn() };
  }
  return holder.current;
}

export { useLazyRef };
