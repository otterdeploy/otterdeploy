import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createContext, type ApiContextVariables } from "@otterdeploy/api/context";
import { appRouter } from "@otterdeploy/api/routers/index";
import { auth } from "@otterdeploy/auth";
import { and, db, eq } from "@otterdeploy/db";
import { member } from "@otterdeploy/db/schema/auth";
import { deploymentLogService } from "@otterdeploy/domain";
import { env } from "@otterdeploy/env/server";
import { createLogger, createRequestLogger } from "@otterdeploy/logger";
import { schema, queries, mutators } from "@otterdeploy/zero";
import { handleQueryRequest } from "@rocicorp/zero/server";
import { handleMutateRequest } from "@rocicorp/zero/server";
import { mustGetQuery, mustGetMutator } from "@rocicorp/zero";
import { zeroNodePg } from "@rocicorp/zero/server/adapters/pg";
import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { cors } from "hono/cors";
import { spawn, type ChildProcess } from "node:child_process";

const logger = createLogger("server");
const dbProvider = zeroNodePg(schema, env.DATABASE_URL);

const app = new Hono<{ Variables: ApiContextVariables }>();
const { upgradeWebSocket, websocket } = createBunWebSocket();

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
  logger.debug({ hasSession: !!session }, "zero session check");
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
  logger.debug({ hasSession: !!session }, "zero session check");
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

app.get(
  "/listen-deployment",
  upgradeWebSocket(async (c) => {
    const deploymentId = c.req.query("deploymentId")?.trim();
    const requestedOrganizationId = c.req.query("organizationId")?.trim();

    if (!deploymentId) {
      return {
        onOpen: (_event, ws) => {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "deploymentId query parameter is required",
            }),
          );
          ws.close(1008, "deploymentId required");
        },
      };
    }

    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user?.id) {
      return {
        onOpen: (_event, ws) => {
          ws.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
          ws.close(1008, "Unauthorized");
        },
      };
    }

    const activeOrganizationId = session.session?.activeOrganizationId ?? null;
    const organizationId = requestedOrganizationId || activeOrganizationId;
    if (!organizationId) {
      return {
        onOpen: (_event, ws) => {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "organizationId query parameter is required",
            }),
          );
          ws.close(1008, "organizationId required");
        },
      };
    }

    const membership = await db.query.member.findFirst({
      where: and(
        eq(member.userId, session.user.id),
        eq(member.organizationId, organizationId),
      ),
    });
    if (!membership) {
      return {
        onOpen: (_event, ws) => {
          ws.send(JSON.stringify({ type: "error", message: "Forbidden" }));
          ws.close(1008, "Forbidden");
        },
      };
    }

    const pathResult = await deploymentLogService.getDeploymentLogPath({
      deploymentId,
      organizationId,
      createIfMissing: true,
    });
    if (pathResult.isErr() || !pathResult.value) {
      return {
        onOpen: (_event, ws) => {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Deployment log not found",
            }),
          );
          ws.close(1008, "Deployment log not found");
        },
      };
    }

    const logPath = pathResult.value;
    let tail: ChildProcess | null = null;
    const stopTail = () => {
      if (tail && !tail.killed) {
        tail.kill("SIGTERM");
      }
      tail = null;
    };

    const parseLine = (line: string) => {
      try {
        const parsed = JSON.parse(line) as {
          timestamp?: string;
          level?: string;
          tab?: string;
          message?: string;
        };
        return {
          deploymentId,
          timestamp:
            parsed.timestamp && !Number.isNaN(Date.parse(parsed.timestamp))
              ? new Date(parsed.timestamp).toISOString()
              : new Date().toISOString(),
          level:
            parsed.level === "debug" ||
            parsed.level === "info" ||
            parsed.level === "warn" ||
            parsed.level === "error"
              ? parsed.level
              : "info",
          tab:
            parsed.tab === "build" ||
            parsed.tab === "deploy" ||
            parsed.tab === "runtime"
              ? parsed.tab
              : "deploy",
          message:
            typeof parsed.message === "string" && parsed.message.length > 0
              ? parsed.message
              : line,
        };
      } catch {
        return {
          deploymentId,
          timestamp: new Date().toISOString(),
          level: "info" as const,
          tab: "deploy" as const,
          message: line,
        };
      }
    };

    return {
      onOpen: (_event, ws) => {
        ws.send(JSON.stringify({ type: "ready", deploymentId }));

        const tailProcess = spawn("tail", ["-n", "0", "-F", logPath], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        tail = tailProcess;

        let stdoutRemainder = "";
        tailProcess.stdout?.on("data", (chunk: Buffer | string) => {
          stdoutRemainder += chunk.toString();
          const lines = stdoutRemainder.split(/\r?\n/);
          stdoutRemainder = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            ws.send(JSON.stringify({ type: "log", log: parseLine(trimmed) }));
          }
        });

        tailProcess.stderr?.on("data", (chunk: Buffer | string) => {
          ws.send(
            JSON.stringify({
              type: "error",
              message: chunk.toString().trim() || "Tail process error",
            }),
          );
        });

        tailProcess.on("exit", (code) => {
          if (code && code !== 0) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: `tail exited with code ${code}`,
              }),
            );
          }
          stopTail();
        });
      },
      onClose: () => {
        stopTail();
      },
      onError: () => {
        stopTail();
      },
    };
  }),
);

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

export default {
  fetch: app.fetch,
  websocket,
};
