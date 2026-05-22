export type DrawerSelection =
  | { kind: "database"; resourceId: string; projectId: string }
  | null;
