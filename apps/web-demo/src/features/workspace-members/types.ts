export type WorkspaceRole = "owner" | "admin" | "deployer" | "viewer";

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: WorkspaceRole;
}
