import { EventSchemas, Inngest } from "inngest";
import type { EventPayloadMap } from "@otterdeploy/events";

// Inngest expects { data: T } format for event schemas
type InngestEventSchemas = {
  [K in keyof EventPayloadMap]: {
    data: EventPayloadMap[K];
  };
};

export const inngest = new Inngest({
  id: "otterstack",
  eventKey: process.env.INNGEST_EVENT_KEY,
  schemas: new EventSchemas().fromRecord<InngestEventSchemas>(),
});
