# oRPC Patterns & Rules

This document defines the mandatory patterns for all oRPC procedures, routers, and error handling in this codebase. All agents and contributors must follow these rules.

---

## 1. Never Use `new ORPCError` Directly

**This is the most important rule.** Every error must be predefined using `.errors()` so the client receives full type safety.

```ts
// ❌ FORBIDDEN — client sees this as an unknown error, no types
throw new ORPCError("NOT_FOUND");
throw new ORPCError("CONFLICT", { message: "Already exists" });

// ✅ REQUIRED — predefined in .errors(), fully typed on the client
throw errors.NOT_FOUND();
throw errors.CONFLICT({ data: { existingId: "abc" } });
```

If an error is not declared in `.errors()`, it is invisible to the client's type system. `isDefinedError` will return `false`, and the client cannot narrow or handle it.

---

## 2. Base Procedure With Common Errors

Define a base procedure that declares errors shared across all routes. Every procedure must extend from this base — never from a bare `os`.

```ts
// src/procedures/base.ts
import { os } from "@orpc/server";
import { z } from "zod";

export const base = os.errors({
  UNAUTHORIZED: {
    status: 401,
    message: "Authentication required",
  },
  FORBIDDEN: {
    status: 403,
    message: "Insufficient permissions",
  },
  NOT_FOUND: {
    status: 404,
    message: "Resource not found",
  },
  CONFLICT: {
    status: 409,
    message: "Resource already exists",
  },
  UNPROCESSABLE_CONTENT: {
    status: 422,
    message: "Validation failed",
  },
  TOO_MANY_REQUESTS: {
    status: 429,
    message: "Rate limit exceeded",
    data: z.object({
      retryAfter: z.number(),
    }),
  },
});
```

Procedures that need domain-specific errors chain additional `.errors()` on top of the base:

```ts
import { base } from "../procedures/base";

const createRisk = base
  .errors({
    DUPLICATE_NAME: {
      status: 409,
      message: "A risk with this name already exists",
      data: z.object({ existingId: z.string() }),
    },
    SCOPE_LIMIT_REACHED: {
      status: 422,
      message: "Maximum risks reached for this scope",
    },
  })
  .input(createRiskInput)
  .output(riskOutput)
  .handler(async ({ input, errors, context }) => {
    // ...
  });
```

---

## 3. Custom Error Status Codes Are Mandatory

Any custom error code (not in the built-in list) defaults to HTTP 500. You must always provide an explicit `status`:

```ts
// ❌ BAD — DUPLICATE_NAME defaults to 500
.errors({
  DUPLICATE_NAME: {
    message: 'Already exists',
  },
})

// ✅ GOOD — explicit status
.errors({
  DUPLICATE_NAME: {
    status: 409,
    message: 'Already exists',
  },
})
```

Built-in codes that auto-map correctly (no override needed): `BAD_REQUEST` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `UNPROCESSABLE_CONTENT` (422), `TOO_MANY_REQUESTS` (429), `INTERNAL_SERVER_ERROR` (500).

---

## 4. Every Procedure Must Have Route Metadata

All procedures must include `.route()` with at minimum a `summary` and `description`. This powers the OpenAPI spec and makes the API self-documenting.

```ts
// ❌ BAD — no route metadata
const list = base.input(listInput).handler(async ({ input }) => {
  /* ... */
});

// ✅ GOOD — route metadata present
const list = base
  .route({
    method: "GET",
    path: "/risks",
    summary: "List risks",
    description: "Returns a paginated list of risks for the given scope.",
    tags: ["risks"],
    deprecated: false,
  })
  .input(listInput)
  .output(z.array(riskOutput))
  .handler(async ({ input }) => {
    /* ... */
  });
```

---

## 5. Every Procedure Must Have `.input()` and `.output()`

Both input and output schemas are mandatory. This ensures full type safety end-to-end and generates accurate OpenAPI specs.

```ts
// ❌ BAD — no output schema
const get = base.input(z.object({ id: z.string() })).handler(async ({ input }) => {
  return db.risks.findById(input.id);
});

// ✅ GOOD — both input and output defined
const get = base
  .route({
    method: "GET",
    path: "/risks/{id}",
    summary: "Get risk by ID",
    description: "Returns a single risk by its unique identifier.",
    tags: ["risks"],
  })
  .input(z.object({ id: z.string() }))
  .output(riskOutput)
  .handler(async ({ input }) => {
    return db.risks.findById(input.id);
  });
```

---

## 6. Procedure Chain Order

Every procedure must follow this exact chain order:

```ts
const create = base                // 1. base procedure
  .errors({ ... })                 // 2. domain-specific errors (if any)
  .route({ ... })                  // 3. route metadata
  .use(authMiddleware)             // 4. middleware (if any)
  .input(schema)                   // 5. input schema
  .output(schema)                  // 6. output schema
  .handler(async ({ ... }) => {    // 7. handler (always last)
    // ...
  })
```

---

## 7. Router Structure — Group by Domain

Routers are organized by domain in folders. Each domain folder has an `index.ts` that re-exports the merged sub-router.

```
src/routers/
├── risk/
│   ├── risks.ts
│   ├── dependencies.ts
│   ├── matrix-config.ts
│   └── index.ts           # merges and re-exports risk router
├── kpi/
│   ├── entries.ts
│   ├── requirements.ts
│   └── index.ts
├── org/
│   ├── members.ts
│   ├── roles.ts
│   └── index.ts
└── index.ts                # root router merging all domains
```

A domain `index.ts`:

```ts
// src/routers/risk/index.ts
import { risks } from "./risks";
import { dependencies } from "./dependencies";
import { matrixConfig } from "./matrix-config";

export const risk = {
  ...risks,
  dependencies,
  matrixConfig,
};
```

The root `index.ts`:

```ts
// src/routers/index.ts
import { risk } from "./risk";
import { kpi } from "./kpi";
import { org } from "./org";

export const appRouter = {
  risk,
  kpi,
  org,
};
```

**Rules:**

- A file stays flat until it has siblings. Once two related files exist, create a folder.
- Domain folders should contain 3–8 files. If a folder exceeds that, split the domain.
- Remove redundant prefixes from filenames. Use `risk/dependencies.ts`, not `risk/risk-dependencies.ts`.

---

## 8. Handlers Must Be Thin

Handlers should contain minimal logic. Extract business logic into service functions:

```ts
// ❌ BAD — fat handler
.handler(async ({ input, errors, context }) => {
  const existing = await db.risks.findByName(input.name)
  if (existing) throw errors.DUPLICATE_NAME({ data: { existingId: existing.id } })
  const count = await db.risks.countByScope(input.scopeId)
  if (count >= 100) throw errors.SCOPE_LIMIT_REACHED()
  const risk = await db.risks.insert(input)
  await sendNotification(risk)
  await auditLog.record('risk.created', risk)
  return risk
})

// ✅ GOOD — thin handler, logic in service
.handler(async ({ input, errors, context }) => {
  return riskService.create(input, { db: context.db, errors })
})
```

---

## 9. Schemas Live Next to Their Procedures

Input/output schemas are defined at the top of the procedure file, not in a separate schemas folder.

```ts
// src/routers/risk/risks.ts
import { z } from "zod";
import { base } from "../../procedures/base";

const createRiskInput = z.object({
  name: z.string().min(1),
  scopeId: z.string(),
  description: z.string().optional(),
});

const riskOutput = z.object({
  id: z.string(),
  name: z.string(),
  scopeId: z.string(),
  description: z.string().nullable(),
  createdAt: z.date(),
});

export const create = base
  .errors({
    /* ... */
  })
  .route({
    method: "POST",
    path: "/risks",
    summary: "Create risk",
    description: "Creates a new risk within a scope.",
    tags: ["risks"],
  })
  .input(createRiskInput)
  .output(riskOutput)
  .handler(async ({ input, errors, context }) => {
    // ...
  });
```

If a schema is shared across multiple domains, place it in `packages/shared/src/validators/`.

---

## 10. Tags Must Match Domain Folders

The `tags` in `.route()` must match the domain folder name. This keeps OpenAPI docs consistent with the codebase structure.

```ts
// File: src/routers/risk/risks.ts
.route({
  tags: ['risks'],       // ✅ matches domain folder
})

// File: src/routers/kpi/entries.ts
.route({
  tags: ['kpi'],         // ✅ matches domain folder
})
```

---

## 11. Error Handling on the Client

### With `safe` (outside TanStack Query)

```ts
import { safe, isDefinedError } from "@orpc/client";

const [error, data, isDefined] = await safe(client.risk.create(input));

if (isDefined) {
  // error is fully typed — TS knows the codes and data shapes
  if (error.code === "DUPLICATE_NAME") {
    redirect(`/risks/${error.data.existingId}`);
  }
  if (error.code === "SCOPE_LIMIT_REACHED") {
    toast.error(error.message);
  }
} else if (error) {
  toast.error("Something went wrong");
} else {
  toast.success(`Created risk ${data.id}`);
}
```

### With TanStack Query

```ts
import { isDefinedError } from "@orpc/client";

const mutation = useMutation(
  orpc.risk.create.mutationOptions({
    onError: (error) => {
      if (isDefinedError(error)) {
        // typed error — autocomplete on .code and .data
        if (error.code === "DUPLICATE_NAME") {
          toast.error(`Already exists: ${error.data.existingId}`);
        }
      } else {
        toast.error("Something went wrong");
      }
    },
  }),
);
```

---

## 12. Domain Folder Rules

- A file stays flat until it has siblings. Once two related files exist, create a folder.
- Domain folders should contain 3–8 files. If a folder exceeds that, split the domain.
- Remove redundant prefixes. Use `risk/dependencies.ts`, not `risk/risk-dependencies.ts`.
- Tags in `.route()` must match the domain folder name.

---

## 13. Forbidden Patterns — Quick Reference

| Pattern                                          | Allowed?  | Reason                               |
| ------------------------------------------------ | --------- | ------------------------------------ |
| `throw new ORPCError('NOT_FOUND')`               | ❌ Never  | Untyped on client                    |
| `throw new ORPCError('CUSTOM', { status: 409 })` | ❌ Never  | Untyped on client                    |
| `throw errors.NOT_FOUND()`                       | ✅ Always | Predefined, typed                    |
| Procedure without `.route()`                     | ❌ Never  | Missing metadata                     |
| Procedure without `.output()`                    | ❌ Never  | Breaks type safety                   |
| Procedure without `.input()`                     | ❌ Never  | Breaks type safety                   |
| Procedure from bare `os`                         | ❌ Never  | Bypasses base errors                 |
| Handler over 20 lines                            | ⚠️ Avoid  | Extract to service                   |
| Schema in separate folder                        | ⚠️ Avoid  | Keep next to procedure unless shared |
| Custom error without explicit `status`           | ❌ Never  | Defaults to 500                      |
