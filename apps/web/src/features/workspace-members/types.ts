export type WorkspaceRole = "owner" | "admin" | "deployer" | "viewer";

export type MemberRow = {
  id: string;
  name: string;
  email: string;
  role: WorkspaceRole;
};
