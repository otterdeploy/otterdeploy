import type { Inngest } from "inngest";

import { EventSchemas, type EventName, type EventPayload } from "./events";

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

    // Validate against schema
    schema.parse(enriched);

    await inngestClient.send({
      name,
      data: enriched as any,
    });
  };
}
