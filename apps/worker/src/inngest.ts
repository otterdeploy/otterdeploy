import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "otterstack",
  eventKey: process.env.INNGEST_EVENT_KEY,
});
