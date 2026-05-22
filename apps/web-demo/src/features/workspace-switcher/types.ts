export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "deployer" | "viewer";
};
