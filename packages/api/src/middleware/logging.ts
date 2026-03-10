import type { Context } from "../context";

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

  console.debug(`[api] procedure started: ${procedure}`, { correlationId });

  try {
    const result = await next();
    const duration = Date.now() - start;
    console.info(`[api] procedure completed: ${procedure}`, { correlationId, duration });
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    console.error(`[api] procedure failed: ${procedure}`, { correlationId, duration, error });
    throw error;
  }
};
