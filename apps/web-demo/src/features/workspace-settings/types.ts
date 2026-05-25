export interface SettingsSection {
  id: string;
  label: string;
  group?: "workspace" | "infrastructure";
}

export const workspaceSettingsSections: ReadonlyArray<SettingsSection> = [
  { id: "overview", label: "Overview", group: "workspace" },
  { id: "account", label: "Account", group: "workspace" },
  { id: "profile", label: "Profile", group: "workspace" },
  { id: "web-server", label: "Web Server", group: "infrastructure" },
  { id: "ssh-keys", label: "SSH Keys", group: "infrastructure" },
  { id: "git-providers", label: "Git Providers", group: "infrastructure" },
  { id: "registries", label: "Registries", group: "infrastructure" },
  { id: "s3-destinations", label: "S3 Destinations", group: "infrastructure" },
  { id: "certificates", label: "Certificates", group: "infrastructure" },
  { id: "cluster", label: "Cluster", group: "infrastructure" },
  { id: "notifications", label: "Notifications", group: "infrastructure" },
  { id: "identity", label: "Identity & SSO", group: "workspace" },
  { id: "billing", label: "Billing", group: "workspace" },
  { id: "danger", label: "Danger", group: "workspace" },
];
