import { EventSchemas as InngestEventSchemas, Inngest } from "inngest";

import type { EventName, EventPayload, EventPayloadMap } from "./events";
import { createEventPublisher } from "./publish";

type InngestSchemaRecord = {
  [K in keyof EventPayloadMap]: {
    data: EventPayloadMap[K];
  };
};

let publisher:
  | ReturnType<typeof createEventPublisher>
  | null = null;

function createInngestClient() {
  const eventKey = process.env.INNGEST_EVENT_KEY;

  return new Inngest({
    id: process.env.INNGEST_APP_ID ?? "otterstack",
    ...(eventKey ? { eventKey } : {}),
    schemas: new InngestEventSchemas().fromRecord<InngestSchemaRecord>(),
  });
}

export function getEventPublisher() {
  if (!publisher) {
    publisher = createEventPublisher(createInngestClient());
  }
  return publisher;
}

export async function publishEvent<TName extends EventName>(
  name: TName,
  data: Omit<EventPayload<TName>, "occurredAt" | "correlationId"> & {
    correlationId?: string;
  },
) {
  return getEventPublisher()(name, data);
}
