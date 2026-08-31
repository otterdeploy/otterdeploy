/**
 * Which resource an `env --service <name>` command actually means.
 *
 * A project's resources share one namespace: the compose stack `postiz`, its
 * child service `postiz-service`, and a database `postiz-db` all sit in the
 * same list. `--service postiz` therefore MATCHED — the stack — and its
 * resourceId went to `service.env.*`, which 404s. The friendly not-found path
 * never ran, because something had matched; the operator saw a bare "Service
 * or project not found" and reasonably concluded env doesn't work on stacks.
 *
 * It does. The child is one suffix away (`pickResourceName` lands the namesake
 * on `-service`), so the fix is to say which children exist rather than to
 * guess. Split out of env.ts on its line cap.
 */
import { suggestions } from "../lib/suggest";
import { abort } from "../lib/ui";

/** The shape of `project.resource.list` this needs: enough to tell a stack
 *  from a service, and to tie a child back to its stack. */
interface ResourceRow {
  resourceId: string;
  name: string;
  type: string;
  stackId?: string | null;
}

/**
 * The service resource named `service`, or an abort that says why not.
 *
 * Three distinct failures, three distinct messages: named a stack, named
 * something that isn't a service, or named nothing that exists.
 */
export function resolveServiceTarget<T extends ResourceRow>(
  resources: readonly T[],
  service: string,
  projectSlug: string,
): T {
  const match = resources.find((r) => r.name === service);

  if (match?.type === "compose") {
    const children = resources
      .filter((r) => r.type === "service" && r.stackId === match.resourceId)
      .map((r) => r.name);
    abort(
      `\`${service}\` is a compose stack, not a service.`,
      ...(children.length > 0
        ? [`its services: ${children.join(", ")}`, `try \`--service ${children[0]}\``]
        : ["it has no services yet"]),
    );
  }

  // Same trap for a database sharing the name: it matches, and only the API
  // knows it is the wrong kind of thing to carry service env.
  if (match && match.type !== "service") {
    abort(
      `\`${service}\` is a ${match.type}, not a service.`,
      "service env vars only apply to services",
    );
  }

  if (!match) {
    abort(
      `No service \`${service}\` in project ${projectSlug}.`,
      ...suggestions(
        service,
        resources.filter((r) => r.type === "service").map((r) => r.name),
      ).map((s) => `did you mean \`${s}\`?`),
    );
  }

  return match;
}
