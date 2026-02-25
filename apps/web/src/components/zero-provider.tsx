import { env } from "@otterdeploy/env/web";
import type { Context } from "@otterdeploy/zero";
import { schema } from "@otterdeploy/zero";
import { mutators } from "@otterdeploy/zero/mutators";
import { ZeroProvider as RocicorpZeroProvider } from "@rocicorp/zero/react";
import { useMemo } from "react";

interface ZeroProviderProps {
  userID: string;
  children: React.ReactNode;
}

export function ZeroProviderWrapper({ userID, children }: ZeroProviderProps) {
  const context: Context = { userId: userID };
  const cacheURL = env.VITE_ZERO_URL;

  const props = useMemo(
    () => ({ schema, userID, context, cacheURL, mutators }),
    [userID, context, cacheURL],
  );

  return <RocicorpZeroProvider {...props}>{children}</RocicorpZeroProvider>;
}
