/**
 * The services of ONE environment, by name.
 *
 * `project.resource.list` answers the project's main environment unless it is
 * given an `environmentId`, and every environment has its own `web`. A deploy
 * to `--env staging` that looked services up without one uploaded the source
 * to production's `web` and waited on production, so the staging service was
 * never built while the command reported success.
 */
import { abort } from "./ui";

export interface EnvironmentServiceLister {
  env: { list(input: { projectId: string }): Promise<Array<{ id: string; slug: string }>> };
  project: {
    resource: {
      list(input: {
        projectId: string;
        environmentId?: string;
      }): Promise<Array<{ type: string; name: string; resourceId: string }>>;
    };
  };
}

/** name -> resourceId of the services in `envSlug` (the main environment when omitted). */
export async function environmentServices(
  client: EnvironmentServiceLister,
  projectId: string,
  envSlug: string | undefined,
): Promise<Map<string, string>> {
  let environmentId: string | undefined;
  if (envSlug) {
    const envs = await client.env.list({ projectId });
    environmentId = envs.find((e) => e.slug === envSlug)?.id;
    if (!environmentId) abort(`No environment \`${envSlug}\` in this project.`);
  }
  const resources = await client.project.resource.list(
    environmentId ? { projectId, environmentId } : { projectId },
  );
  return new Map(resources.filter((r) => r.type === "service").map((r) => [r.name, r.resourceId]));
}
