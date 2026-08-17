import * as React from "react";

/**
 * @see https://github.com/radix-ui/primitives/blob/main/packages/react/use-callback-ref/src/useCallbackRef.tsx
 */

/**
 * A custom hook that converts a callback to a ref to avoid triggering re-renders when passed as a
 * prop or avoid re-executing effects when passed as a dependency
 */
// The public signature keeps the caller's exact function type; the
// implementation signature below is the structurally-honest version of it
// (a fresh wrapper can't be proven to BE `T`), so the pairing replaces the
// old `as T` assertion with an overload instead of a cast.
function useCallbackRef<T extends (...args: never[]) => unknown>(callback: T | undefined): T;
function useCallbackRef(
  callback: ((...args: never[]) => unknown) | undefined,
): (...args: never[]) => unknown {
  const callbackRef = React.useRef(callback);

  React.useEffect(() => {
    callbackRef.current = callback;
  });

  // https://github.com/facebook/react/issues/19240
  return (...args) => callbackRef.current?.(...args);
}

export { useCallbackRef };
