import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/")({
  component: RouteComponent,
});

interface BaseResource {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  status: "online" | "degraded" | "crashed" | "unknown" | "deploying" | "stopped";
  deployments: Deployment[];
}

interface DatabaseResource extends BaseResource {
  type: "database";
  engine:
    | "postgres"
    | "mysql"
    | "mongodb"
    | "redis"
    | "cassandra"
    | "dynamodb"
    | "elasticsearch"
    | "solr"
    | "couchbase"
    | "other";

  volume: {
    /**
     * The size of the volume in gigabytes.
     * @default 5
     */
    size: number;
    /**
     * The mount path of the volume.
     * @default /var/lib/$DATABASE_NAME/data
     */
    mountPath: string;
  };
  variables: Record<string, string | number | boolean>;
}

type Resource = DatabaseResource | ServiceResource;

interface BaseBuildConfig {
  buildCommand: string;
  watchPatterns: RegExp[];
}

interface NixpacksBuildConfig extends BaseBuildConfig {
  builder: "nixpacks";
}

interface DockerfileBuildConfig extends BaseBuildConfig {
  builder: "dockerfile";
  dockerfilePath: string;
}

interface BuildpackBuildConfig extends BaseBuildConfig {
  builder: "buildpack";
}

interface DockerImageBuildConfig extends BaseBuildConfig {
  builder: "docker_image";
  image: string;
}

interface StaticBuildConfig extends BaseBuildConfig {
  builder: "static";
  directory: string;
}

interface ComposeBuildConfig extends BaseBuildConfig {
  builder: "compose";
  composeFilePath: string;
}

type BuildConfig =
  | NixpacksBuildConfig
  | DockerfileBuildConfig
  | BuildpackBuildConfig
  | DockerImageBuildConfig
  | StaticBuildConfig
  | ComposeBuildConfig;

interface ServiceResource extends BaseResource {
  type: "service";
  build: BuildConfig;
}

interface Deployment {
  id: string;
  resourceId: string;
  source: "git" | "manual";
  status: "building" | "deploying" | "deployed" | "failed" | "canceled" | "rolled_back";
  createdAt?: number;
  startedAt?: number;
  completedAt?: number;
}

const project = {
  id: "1",
  name: "Project 1",
  description: "Project 1 description",
  createdAt: new Date(),
  updatedAt: new Date(),
  owner: {
    id: "1",
    name: "John Doe",
    email: "john.doe@example.com",
  },
  members: [{ id: "1", name: "John Doe", email: "john.doe@example.com" }],

  environments: [
    {
      id: "1",
      name: "Environment 1",
      description: "Environment 1 description",
      createdAt: new Date(),
      updatedAt: new Date(),

      resources: [
        {
          id: "1",
          name: "Resource 1",
          description: "Resource 1 description",
          createdAt: new Date(),
          updatedAt: new Date(),
          type: "database",
          engine: "postgres",
          volume: {
            size: 5,
            mountPath: "/var/lib/postgres/data",
          },
          deployments: [],
          status: "online",
          variables: {},
        },
      ] satisfies Resource[],
    },
  ],
};

function RouteComponent() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="text-sm text-gray-500">Welcome to the dashboard</p>
    </div>
  );
}
