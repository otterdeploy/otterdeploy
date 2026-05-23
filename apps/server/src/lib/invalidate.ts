import type { WSContext } from "hono/ws";

// Map of resource group → set of subscribed clients
const subscriptions = new Map<string, Set<WSContext>>();

export const invalidate = {
  onMessage(ws: WSContext, data: string) {
    const msg = JSON.parse(data);
    if (msg.type === "subscribe" && typeof msg.resource === "string") {
      if (!subscriptions.has(msg.resource)) {
        subscriptions.set(msg.resource, new Set());
      }
      subscriptions.get(msg.resource)?.add(ws);
    } else if (msg.type === "unsubscribe" && typeof msg.resource === "string") {
      subscriptions.get(msg.resource)?.delete(ws);
    }
  },
  removeClient(ws: WSContext) {
    for (const clients of subscriptions.values()) {
      clients.delete(ws);
    }
  },
  broadcast(resource: string) {
    const clients = subscriptions.get(resource);
    if (!clients) return;
    const message = JSON.stringify({ type: "invalidate", resource });
    for (const client of clients) {
      client.send(message);
    }
  },
};
