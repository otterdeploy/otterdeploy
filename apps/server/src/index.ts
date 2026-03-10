import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { createHealthRouter } from "@otterdeploy/api";
import { auth } from "@otterdeploy/auth";
import { env } from "@otterdeploy/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createSSEHandler } from "./sse";

const app = new Hono();

// CORS
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
);

// Better Auth
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// oRPC API
const router = createHealthRouter();
const rpcHandler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error("RPC error", error);
    }),
  ],
});

app.use("/rpc/*", async (c, next) => {
  const result = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
  });

  if (result.matched) {
    return c.newResponse(result.response.body, result.response);
  }

  await next();
});

// SSE endpoint
app.get("/api/events", createSSEHandler());

// Health check
app.get("/", (c) => c.text("OK"));

export default {
  fetch: app.fetch,
};
