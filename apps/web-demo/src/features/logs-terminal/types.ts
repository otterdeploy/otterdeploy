export type LogsScope =
  | { kind: "project"; projectId: string }
  | { kind: "resource"; projectId: string; resourceId: string; resourceName: string };
