import { orpc } from "@/utils/orpc";
import { createFileRoute, redirect } from "@tanstack/react-router";
import * as z from "zod";

const searchSchema = z.object({
  envId: z.string().optional(),
});

export const Route = createFileRoute("/_dashboard/project/$projectId")({
  component: RouteComponent,
  validateSearch: searchSchema,
  beforeLoad: async ({ context, search: { envId }, params: { projectId } }) => {
    if (envId) return;
    console.log("no envId provided");

    envId = await context.queryClient.ensureQueryData(
      orpc.environment.list.queryOptions({
        input: {
          projectId: projectId,
        },
      }),
    );

    if (!envId) throw new Error("No environments found");

    throw redirect({ to: "/project/$projectId", params: { projectId }, search: { envId } });
  },
  loaderDeps: ({ search: { envId } }) => ({ envId }),
  loader: async ({ context, deps, params }) => {
    const { envId } = deps;

    if (!envId) throw new Error("No environment id provided");

    const [env, resources, graph] = await Promise.all([
      context.queryClient.ensureQueryData(
        orpc.environment.getById.queryOptions({
          input: {
            environmentId: envId,
          },
        }),
      ),

      context.queryClient.ensureQueryData(
        orpc.resource.list.queryOptions({
          input: {
            projectId: params.projectId,
            environmentId: envId,
          },
        }),
      ),
      context.queryClient.ensureQueryData(
        orpc.architecture.getGraph.queryOptions({
          input: {
            projectId: params.projectId,
            environmentId: envId,
          },
        }),
      ),
    ]);
    // get domains for each resource

    return { env, resources, graph };
  },

  errorComponent: ({ error }) => <div>Error: {error.message}</div>,
});

function RouteComponent() {
  const { projectId } = Route.useParams();
  const { env, resources } = Route.useLoaderData();

  return (
    <div>
      <h1>{env.name}</h1>
      <ul>
        {resources.map((resource) => (
          <li key={resource.id}>{resource.name}</li>
        ))}
      </ul>
    </div>
  );
}
