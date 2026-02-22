import { ZeroProvider as RocicorpZeroProvider } from "@rocicorp/zero/react";
import { schema } from "@otterdeploy/zero";
import type { Context } from "@otterdeploy/zero";
import { mutators } from "@otterdeploy/zero/mutators";
import { env } from "@otterdeploy/env/web";
import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";
import type { Zero } from "@rocicorp/zero";

interface ZeroProviderProps {
  userID: string;
  children: React.ReactNode;
}

export function ZeroProviderWrapper({ userID, children }: ZeroProviderProps) {
  const router = useRouter();
  const context: Context = { userId: userID };
  const cacheURL = env.VITE_ZERO_URL;

  const init = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (zero: Zero) => {
      router.update({
        context: {
          ...router.options.context,
          zero,
        },
      });
    },
    [],
  );

  return (
    <RocicorpZeroProvider {...{ schema, userID, context, cacheURL, mutators, init }}>
      {children}
    </RocicorpZeroProvider>
  );
}
