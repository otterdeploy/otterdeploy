import { useEffect } from "react";
import { queryClient } from "@/utils/orpc";
import { envCollection } from "@/features/environment-switcher/api";

const wsUrl = `ws://localhost:4293/ws`;

let refCount = 0;
let ws: WebSocket | null = null;
const pendingSubscriptions: string[] = [];

function getSocket() {
  if (!ws || ws.readyState === WebSocket.CLOSED) {
    ws = new WebSocket(wsUrl);
    ws.addEventListener("open", () => {
      for (const resource of pendingSubscriptions) {
        if (!ws) break;
        ws.send(JSON.stringify({ type: "subscribe", resource }));
      }
      pendingSubscriptions.length = 0;
    });
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "invalidate") {
        // Invalidate all queries that start with the resource name
        envCollection.utils.refetch();
        envCollection.utils.queryClient.invalidateQueries({ queryKey: [data.resource] });
      }
    });
  }
  return ws;
}

function subscribe(socket: WebSocket, resource: string) {
  const msg = JSON.stringify({ type: "subscribe", resource });
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(msg);
  } else {
    pendingSubscriptions.push(resource);
  }
}

function unsubscribe(socket: WebSocket, resource: string) {
  const msg = JSON.stringify({ type: "unsubscribe", resource });
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(msg);
  }
}

export function useInvalidationSocket(resource: string) {
  useEffect(() => {
    const socket = getSocket();
    refCount++;
    subscribe(socket, resource);
    return () => {
      unsubscribe(socket, resource);
      refCount--;
      if (refCount === 0) {
        socket.close();
        ws = null;
      }
    };
  }, [resource]);
}
