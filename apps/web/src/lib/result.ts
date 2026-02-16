import { Result } from "better-result";

export function toUserMessage(error: unknown, fallback: string): string {
  const result = Result.try({
    try: () => {
      if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
      }
      return fallback;
    },
    catch: () => fallback,
  });

  return result.unwrapOr(fallback);
}
