export type ActivityKind = "deploy" | "create" | "delete" | "update" | "auth";

export type ActivityRow = {
  id: string;
  kind: ActivityKind;
  actor: { id: string; name: string };
  object: { kind: "project" | "database" | "service" | "route"; name: string };
  occurredAt: string;
};
