import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Owns the single update modal (the ResourceOverlayProvider idiom) and kicks off
 * a background update check on load so the banner/header light up on their own —
 * the operator never has to visit Platform to learn an update exists. Any
 * trigger just calls `openUpdate()`.
 */
import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

import { useCheckForUpdate } from "../data/use-update-status";
import { UpdateDialog } from "./update-dialog";

const CHECK_STALE_MS = 60 * 60 * 1000; // re-check at most hourly per load

interface UpdateContextValue {
  openUpdate: () => void;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const settings = useQuery({ ...orpc.system.updateSettings.get.queryOptions(), retry: false });
  const check = useCheckForUpdate();
  const checkedRef = useRef(false);

  // Auto-check once per load if the cached result is stale (or never fetched).
  // Failures (e.g. a member without platform:read) are swallowed — the feature
  // simply stays hidden.
  useEffect(() => {
    if (checkedRef.current || settings.isLoading) return;
    if (settings.isError) {
      checkedRef.current = true;
      return;
    }
    const last = settings.data?.lastCheckedAt ? Date.parse(settings.data.lastCheckedAt) : 0;
    if (Date.now() - last > CHECK_STALE_MS) {
      checkedRef.current = true;
      check.mutate({});
    }
  }, [settings.data, settings.isLoading, settings.isError, check]);

  return (
    <UpdateContext.Provider value={{ openUpdate: () => setOpen(true) }}>
      {children}
      <UpdateDialog open={open} onOpenChange={setOpen} />
    </UpdateContext.Provider>
  );
}

export function useUpdate(): UpdateContextValue {
  const ctx = useContext(UpdateContext);
  if (!ctx) throw new Error("useUpdate must be used inside <UpdateProvider>");
  return ctx;
}
