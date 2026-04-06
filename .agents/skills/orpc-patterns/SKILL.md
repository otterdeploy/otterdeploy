---
name: kaitosec-orpc
description: KaitoSec oRPC house style for procedures, routers, typed errors, and client-side error handling. Use when creating, refactoring, reviewing, or migrating code in `packages/api/src` that touches `@orpc/server`, `@orpc/client`, `ORPCError`, `.errors()`, `.route()`, `.input()`, `.output()`, OpenAPI metadata, or router/domain structure.
---

# KaitoSec oRPC

Keep KaitoSec's oRPC API surface typed, documented, and structurally consistent.

Read [references/orpc-patterns-and-rules.md](references/orpc-patterns-and-rules.md) before making non-trivial oRPC changes. Treat that file as the authoritative ruleset for procedure shape, errors, metadata, router organization, and client handling.

## Workflow

1. Inspect the touched area in `packages/api/src`.
2. Identify whether the change affects:
   - procedure errors
   - procedure chain order
   - route metadata or schemas
   - handler size and service extraction
   - router/domain folder structure
   - client-side error narrowing
3. Apply the smallest compliant refactor that leaves the touched area closer to the house style.
4. Validate with the repository-approved commands when the change is substantial:
   - `bun run typecheck`
   - `bun run check`

## Non-Negotiables

- Never throw `new ORPCError(...)` directly from procedures or middleware when a defined error can be used instead.
- Define errors with `.errors()` so clients can narrow them with `isDefinedError`.
- Always provide `.route()`, `.input()`, and `.output()` on procedures.
- Keep the procedure chain in this order:
  `base -> .errors() -> .route() -> .use() -> .input() -> .output() -> .handler()`
- Keep handlers thin. Move business logic into service functions when the handler starts accumulating branching, persistence, or side effects.
- Keep input/output schemas at the top of the procedure file unless the schema is truly shared, in which case place it under `packages/shared/src/validators/`.

## Repository Guidance

- The current repo still has many flat files in `packages/api/src/routers` and many direct `ORPCError` throws. When touching those areas, prefer incremental migration rather than unrelated sweeping rewrites.
- If the work introduces or reorganizes a domain with multiple related router files, follow the folder rules from the reference and create a domain `index.ts`.
- If a common typed base procedure does not yet exist for the area you are touching, introduce or extend a `procedures/base.ts` style abstraction instead of building more procedures directly from bare `os`.
- Keep route tags aligned with the domain folder name used on disk.

## Error Rules

- Declare shared errors on a base procedure and domain-specific errors with chained `.errors()`.
- Give every custom error code an explicit HTTP `status`.
- Throw predefined errors via the generated `errors` object:
  - `throw errors.NOT_FOUND()`
  - `throw errors.CONFLICT({ data: { existingId } })`
- Preserve typed `data` shapes whenever the client needs to branch on extra payload.

## Router Rules

- Keep routers grouped by domain when siblings exist.
- Remove redundant filename prefixes inside a domain folder.
- Favor small domain folders over a single giant router file.
- Re-export merged domain routers from `index.ts`, then merge them again in the root router.

## Review Checklist

When reviewing or writing oRPC code, check for all of the following:

- direct `new ORPCError(...)` usage
- missing `.route()`
- missing `.input()` or `.output()`
- incorrect procedure chain order
- custom errors without `status`
- fat handlers that should call a service
- tags that do not match the domain folder
- flat router files that should now become a folder
- client code that handles defined errors as untyped generic failures

## Useful Paths

- `packages/api/src/index.ts`
- `packages/api/src/routers/index.ts`
- `packages/api/src/routers/`

Use those files to understand the current baseline before applying the stricter target pattern from the reference.
