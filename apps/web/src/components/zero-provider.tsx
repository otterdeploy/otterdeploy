import { type Zero } from "@rocicorp/zero";
import { ZeroProvider as RocicorpZeroProvider } from "@rocicorp/zero/react";
import { schema } from "@otterdeploy/zero";
import { queries } from "@otterdeploy/zero/queries";
import { env } from "@otterdeploy/env/web";
import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";

interface ZeroProviderProps {
  userID: string;
  children: React.ReactNode;
}

export function ZeroProviderWrapper({ userID, children }: ZeroProviderProps) {
  const router = useRouter();
  const context = { userId: userID };
  const cacheURL = env.VITE_ZERO_URL;

  const init = useCallback(
    (zero: Zero) => {
      router.update({
        context: {
          ...router.options.context,
          zero,
        },
      });
      router.invalidate();
    },
    [router],
  );

  return (
    <RocicorpZeroProvider
      {...{ schema, userID, context, cacheURL, init }}
    >
      {children}
    </RocicorpZeroProvider>
  );
}
