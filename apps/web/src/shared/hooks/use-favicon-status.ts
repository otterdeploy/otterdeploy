/**
 * Drives the browser-tab favicon from the app status rollup.
 *
 * Mounted once, at the app shell. Everything it shows comes from
 * `reportAppStatus` callers: this hook only adds the one thing a pure rollup
 * cannot express: the moment a deploy *finishes*. Live task states go straight
 * from "building" to "running", which rolls up to idle; without an edge
 * detector the tab would snap from spinning to blank and the operator would
 * never learn whether it worked.
 */

import { useEffect, useRef, useState } from "react";

import type { MarkStatus } from "@/shared/components/brand/mark-geometry";

import { useAppStatus } from "@/shared/lib/app-status";
import { resetFavicon, setFaviconStatus } from "@/shared/lib/favicon";

/** How long "deployed" holds the tab before it settles back to idle. */
const SUCCESS_HOLD_MS = 6000;

export function useFaviconStatus(): MarkStatus {
  const rolled = useAppStatus();
  const [displayed, setDisplayed] = useState<MarkStatus>(rolled);
  const previous = useRef<MarkStatus>(rolled);

  useEffect(() => {
    const wasDeploying = previous.current === "deploying";
    previous.current = rolled;

    // A deploy that lands cleanly earns a brief green tick. One that lands on
    // an error or a warning does not. That state is the news, and overwriting
    // it with a tick would be a lie.
    if (wasDeploying && rolled === "idle") {
      setDisplayed("success");
      const t = setTimeout(() => setDisplayed("idle"), SUCCESS_HOLD_MS);
      return () => clearTimeout(t);
    }

    setDisplayed(rolled);
    return undefined;
  }, [rolled]);

  useEffect(() => {
    setFaviconStatus(displayed);
  }, [displayed]);

  // Restore the static icon if the shell ever unmounts (HMR, route teardown),
  // so a stale animation loop cannot outlive the tree that started it.
  useEffect(() => resetFavicon, []);

  return displayed;
}
