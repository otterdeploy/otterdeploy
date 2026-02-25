import { env } from "@otterdeploy/env/web";
import type { Context, Schema } from "@otterdeploy/zero";
import { schema } from "@otterdeploy/zero";
import { mutators } from "@otterdeploy/zero/mutators";
import type { Zero } from "@rocicorp/zero";
import { ZeroProvider as RocicorpZeroProvider } from "@rocicorp/zero/react";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

interface ZeroProviderProps {
  userID: string;
  children: React.ReactNode;
}

export function ZeroProviderWrapper({ userID, children }: ZeroProviderProps) {
  const cacheURL = env.VITE_ZERO_URL;

  const router = useRouter();

  const context: Context = useMemo(() => ({ userId: userID }), [userID]);

  const props = useMemo(
    () => ({ schema, userID, context, cacheURL, mutators }),
    [userID, context, cacheURL],
  );

  const init = useCallback(
    (zero: Zero) => {
      router.update({
        context: {
          ...router.options.context,
          zero: zero as Zero<Schema>,
        },
      });
      router.invalidate();
    },
    [router],
  );

  return (
    <RocicorpZeroProvider {...props} init={init}>
      {children}
    </RocicorpZeroProvider>
  );
}
