export interface OtterStackLabels {
  "otterstack.resource.id": string;
  "otterstack.project.id": string;
  "otterstack.environment.id": string;
  "otterstack.organization.id": string;
}

export interface SwarmInitResult {
  nodeId: string;
  alreadyActive: boolean;
}

export interface NetworkCreateResult {
  networkId: string;
  alreadyExists: boolean;
}
