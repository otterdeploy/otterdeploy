import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createContext, type ApiContextVariables } from "@otterdeploy/api/context";
import { appRouter } from "@otterdeploy/api/routers/index";
import { auth } from "@otterdeploy/auth";
import { env } from "@otterdeploy/env/server";
import { createLogger, createRequestLogger } from "@otterdeploy/logger";
import { schema, queries, mutators } from "@otterdeploy/zero";
import { handleQueryRequest } from "@rocicorp/zero/server";
import { handleMutateRequest } from "@rocicorp/zero/server";
import { mustGetQuery, mustGetMutator } from "@rocicorp/zero";
import { zeroNodePg } from "@rocicorp/zero/server/adapters/pg";
import { Hono } from "hono";
import { cors } from "hono/cors";

const logger = createLogger("server");
const dbProvider = zeroNodePg(schema, env.DATABASE_URL);

const app = new Hono<{ Variables: ApiContextVariables }>();

app.use(createRequestLogger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-organization-id", "x-request-id"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Zero auth endpoint — zero-cache forwards cookies here to verify the user session.
app.get("/api/zero/auth", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session?.user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return c.json({
    userID: session.user.id,
    organizationId: session.session?.activeOrganizationId ?? null,
  });
});

// Zero query endpoint — zero-cache forwards query requests here for auth-scoped data.
app.post("/api/zero/query", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  console.log({ session });
  const ctx = session ? { userId: session.user.id } : undefined;
  const result = await handleQueryRequest(
    (name, args) => {
      const query = mustGetQuery(queries, name);
      return query.fn({ args, ctx });
    },
    schema,
    c.req.raw,
  );

  return c.json(result);
});

// Zero mutate endpoint — zero-cache forwards mutation requests here.
app.post("/api/zero/mutate", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  console.log({ session });
  if (!session?.user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const ctx = { userId: session.user.id };
  const result = await handleMutateRequest(
    dbProvider,
    async (transact) => {
      return await transact(async (tx, name, args) => {
        const mutator = mustGetMutator(mutators, name);
        return await mutator.fn({ tx, ctx, args });
      });
    },
    c.req.raw,
  );

  logger.info({ result }, "Zero mutate result");
  return c.json(result);
});

export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      logger.error({ err: error }, "OpenAPI error");
    }),
  ],
});

export const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      logger.error({ err: error }, "RPC error");
    }),
  ],
});

app.use("/*", async (c, next) => {
  const context = await createContext({ context: c });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: context,
  });

  if (rpcResult.matched) {
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api-reference",
    context: context,
  });

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

app.get("/", (c) => {
  return c.text("OK");
});

export default app;
