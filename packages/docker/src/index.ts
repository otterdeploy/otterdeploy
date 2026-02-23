export { getDockerClient, setDockerClient, resetDockerClient } from "./client";
export { initSwarm, isSwarmActive, createIngressNetwork } from "./swarm";
export type {
  OtterStackLabels,
  SwarmInitResult,
  NetworkCreateResult,
} from "./types";
