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

// --- Service types ---

export interface CreateServiceOpts {
  name: string;
  image: string;
  env?: string[];
  ports?: Array<{ target: number; published?: number }>;
  volumes?: Array<{ source: string; target: string; type?: "volume" | "bind" }>;
  networks?: string[];
  labels: OtterStackLabels & Record<string, string>;
  healthCheck?: {
    cmd: string;
    interval: number;
    timeout: number;
    retries: number;
  };
  restartPolicy?: "always" | "on-failure" | "none";
  resourceLimits?: { cpuLimit?: number; memoryLimitMb?: number };
  replicas?: number;
}

export interface UpdateServiceOpts {
  image?: string;
  env?: string[];
  ports?: Array<{ target: number; published?: number }>;
  volumes?: Array<{ source: string; target: string; type?: "volume" | "bind" }>;
  networks?: string[];
  labels?: Record<string, string>;
  healthCheck?: {
    cmd: string;
    interval: number;
    timeout: number;
    retries: number;
  };
  resourceLimits?: { cpuLimit?: number; memoryLimitMb?: number };
  replicas?: number;
}

export interface ServiceLogOpts {
  tail?: number;
  since?: number;
  until?: number;
  follow?: boolean;
  stdout?: boolean;
  stderr?: boolean;
  timestamps?: boolean;
}

export interface ServiceInfo {
  id: string;
  name: string;
  image: string;
  replicas: number;
  labels: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

// --- Container / Stats types ---

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

export interface ContainerStats {
  cpuPercent: number;
  memoryUsageMb: number;
  memoryLimitMb: number;
  memoryPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
}

export interface ExecResult {
  exitCode: number;
  output: string;
}

export interface DiskUsageInfo {
  images: { totalCount: number; totalSizeMb: number };
  containers: { totalCount: number; totalSizeMb: number };
  volumes: { totalCount: number; totalSizeMb: number };
  buildCache: { totalSizeMb: number };
}

// --- Volume types ---

export interface VolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
  labels: Record<string, string>;
  createdAt: string;
}

// --- Image types ---

export interface ImageInfo {
  id: string;
  repoTags: string[];
  sizeMb: number;
  created: number;
}

// --- Config types ---

export interface DockerConfigInfo {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// --- Secret types ---

export interface DockerSecretInfo {
  id: string;
  name: string;
  labels: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
