/**
 * Per-template environment schemas, in `@env-spec` format (the `.env.schema`
 * standard varlock reads).
 *
 * Why a standard format rather than a field on `StackTemplate`: the schema is
 * the artifact upstream projects are starting to ship themselves, so anything
 * we build against it can eventually consume theirs instead of us
 * transcribing. It also means `varlock` can lint our own files.
 *
 * OWNERSHIP IS THE VALUE. There is no `@owner` decorator to keep in sync:
 *
 *   MAIN_URL=${{stack.postiz.PUBLIC_URL}}   platform-owned, derived
 *   LINKEDIN_CLIENT_ID=                     operator-owned, must be supplied
 *   API_LIMIT=30                            defaulted, operator may override
 *
 * A platform-owned var is one otterdeploy can answer for itself, and writing
 * one as a literal is the bug this whole layer exists to prevent: a literal is
 * correct once, at install, and silently wrong from the next domain rename on.
 * `env-schema.test.ts` fails the build for it.
 *
 * The two ref syntaxes coexist deliberately. Single-brace `${VAR}` is both
 * compose interpolation and env-spec's own `ref()`; double-brace `${{…}}` is
 * otterdeploy's cross-resource ref, which the env-spec parser preserves
 * verbatim as a static value rather than trying to resolve.
 */
import postiz from "./postiz.env.schema?raw";

/** Template id → its `.env.schema` source. Templates absent from this map are
 *  simply not covered by the gate yet; adding one opts it in. */
export const ENV_SCHEMAS: Record<string, string> = { postiz };
