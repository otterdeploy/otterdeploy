import { Zero } from "@rocicorp/zero";
import { schema, type Schema } from "@otterdeploy/zero";
import { env } from "@otterdeploy/env/web";

let zeroInstance: Zero<Schema> | null = null;

export function getZero(userID: string): Zero<Schema> {
  if (zeroInstance && zeroInstance.userID === userID) {
    return zeroInstance;
  }

  if (zeroInstance) {
    zeroInstance.close();
  }

  zeroInstance = new Zero({
    userID,
    schema,
    server: env.VITE_ZERO_URL,
  });

  return zeroInstance;
}

export function closeZero() {
  if (zeroInstance) {
    zeroInstance.close();
    zeroInstance = null;
  }
}
