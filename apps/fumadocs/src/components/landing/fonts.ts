"use client";

import { useEffect } from "react";

export function useFonts() {
  useEffect(() => {
    const id = "dark-paas-community-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap";
    document.head.appendChild(link);
  }, []);
}

export const font = {
  display: { fontFamily: "'Plus Jakarta Sans', sans-serif" },
  body: { fontFamily: "'Plus Jakarta Sans', sans-serif" },
  mono: { fontFamily: "'JetBrains Mono', monospace" },
};

export const ease = {
  type: "tween" as const,
  ease: "easeOut" as const,
  duration: 0.4,
};
