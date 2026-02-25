import { createLogger } from "@otterdeploy/logger";
import type { Context } from "../context";

const log = createLogger("api");

export const loggingMiddleware = async (
  {
    context,
    path,
    next,
  }: { context: Context; path: readonly string[]; next: (...args: any[]) => any },
  _input: unknown,
) => {
  const procedure = path.join(".");
  const correlationId = context.correlationId ?? undefined;
  const start = Date.now();

  log.debug({ procedure, correlationId }, "procedure started");

  try {
    const result = await next();
    const duration = Date.now() - start;
    log.info({ procedure, correlationId, duration }, "procedure completed");
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    log.error({ procedure, correlationId, duration, err: error }, "procedure failed");
    throw error;
  }
};
