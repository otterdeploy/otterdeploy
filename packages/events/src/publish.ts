import type { Inngest } from "inngest";
import { Result, TaggedError } from "better-result";

import { EventSchemas, type EventName, type EventPayload } from "./events";

class EventValidationError extends TaggedError("EventValidationError")<{
  eventName: EventName;
  message: string;
  cause: unknown;
}>() {}

class EventPublishError extends TaggedError("EventPublishError")<{
  eventName: EventName;
  message: string;
  cause: unknown;
}>() {}

export type PublishEventError = EventValidationError | EventPublishError;

export function createEventPublisher(inngestClient: Inngest) {
  return async function publish<TName extends EventName>(
    name: TName,
    data: Omit<EventPayload<TName>, "occurredAt" | "correlationId"> & {
      correlationId?: string;
    },
  ) {
    const schema = EventSchemas[name];
    const enriched = {
      ...data,
      occurredAt: new Date().toISOString(),
      correlationId: data.correlationId ?? crypto.randomUUID(),
    };

    const validatedResult = Result.try({
      try: () => schema.parse(enriched),
      catch: (cause) =>
        new EventValidationError({
          eventName: name,
          message: `Event payload validation failed for ${name}`,
          cause,
        }),
    });

    if (validatedResult.isErr()) {
      return validatedResult;
    }

    return Result.tryPromise({
      try: async () => {
        await inngestClient.send({
          name,
          data: validatedResult.value,
        });
      },
      catch: (cause) =>
        new EventPublishError({
          eventName: name,
          message: `Failed to publish ${name} event`,
          cause,
        }),
    });
  };
}
