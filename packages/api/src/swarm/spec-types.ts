/**
 * Docker Swarm service-spec payload shapes — the subset of the Engine API's
 * TaskTemplate this driver actually sets (https://docs.docker.com/engine/api/
 * — ServiceSpec.TaskTemplate). Written as type aliases, not interfaces, so
 * they get implicit index signatures and stay assignable to the docker
 * client's wider string-keyed TaskTemplate slot.
 */

import type { SpecMount } from "./file-mounts";

// oxlint-disable-next-line typescript/consistent-type-definitions
export type SwarmHealthcheck = {
  Test: string[];
  /** Nanoseconds, like every duration in the swarm API. */
  Interval: number;
  Timeout: number;
  Retries: number;
  StartPeriod: number;
};

// oxlint-disable-next-line typescript/consistent-type-definitions
export type SwarmContainerSpec = {
  Image: string;
  Env: string[];
  Hostname: string;
  Labels: Record<string, string>;
  /** Docker spec: ContainerSpec.Command = ENTRYPOINT, ContainerSpec.Args = CMD. */
  Command?: string[];
  Args?: string[];
  Healthcheck?: SwarmHealthcheck;
  Mounts?: SpecMount[];
};

// oxlint-disable-next-line typescript/consistent-type-definitions
export type SwarmResourceObject = {
  NanoCPUs?: number;
  MemoryBytes?: number;
};

// oxlint-disable-next-line typescript/consistent-type-definitions
export type SwarmTaskResources = {
  Limits?: SwarmResourceObject;
  Reservations?: SwarmResourceObject;
};

// oxlint-disable-next-line typescript/consistent-type-definitions
export type SwarmTaskTemplate = {
  ContainerSpec: SwarmContainerSpec;
  Networks: Array<{ Target: string; Aliases: string[] }>;
  RestartPolicy: {
    Condition: string;
    MaxAttempts: number;
    Delay: number;
    Window: number;
  };
  ForceUpdate?: number;
  Placement?: { Constraints: string[] };
  Resources?: SwarmTaskResources;
};
