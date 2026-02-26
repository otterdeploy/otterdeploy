import type { Result } from "better-result";

export interface BuildInput {
  sourceDir: string;
  resourceId: string;
  deploymentNumber: number;
  env: Record<string, string>;
  buildArgs?: Record<string, string>;
  buildCommand?: string;
  startCommand?: string;
  dockerfilePath?: string;
  rootDirectory?: string;
  force?: boolean;
  timeout?: number; // ms, default 600_000 (10 min)
  onLogLine?: (line: string, stream: "stdout" | "stderr") => void | Promise<void>;
}

export interface BuildOutput {
  imageName: string;
  imageTag: string;
  durationMs: number;
  logs: string[];
}

export type BuildMethod =
  | "nixpacks"
  | "dockerfile"
  | "docker_image"
  | "static"
  | "compose";

export interface Builder {
  build(input: BuildInput): Promise<Result<BuildOutput, Error>>;
}
