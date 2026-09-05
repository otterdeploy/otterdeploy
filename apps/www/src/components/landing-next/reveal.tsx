import { type ReactNode, useEffect, useRef } from "react";

import { cx } from "../landing/primitives";

/**
 * Fade-and-rise on scroll entry, the way linear.app's sections arrive. Pure
 * class toggling: the transition lives in app.css behind a reduced-motion
 * gate, so readers who asked for less motion get content in place instantly.
 * SSR is visible by default. Once JavaScript and IntersectionObserver are
 * ready, offscreen elements opt into the hidden starting state.
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  /** Stagger, in ms. */
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const bounds = el.getBoundingClientRect();
    if (bounds.bottom >= 0 && bounds.top <= window.innerHeight * 0.9) {
      el.classList.add("is-in");
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add("is-in");
            io.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
    );
    el.classList.add("is-ready");
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={cx("od-reveal", className)} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}
