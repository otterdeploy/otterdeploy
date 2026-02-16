export const SECRET_PROVIDERS = ["infisical", "native_breakglass"] as const;
export type SecretProvider = (typeof SECRET_PROVIDERS)[number];

export const SECRET_KINDS = [
  "env_var",
  "ssh_private_key",
  "git_client_secret",
  "git_webhook_secret",
] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

export const SECRET_SCOPES = [
  "organization",
  "project",
  "environment",
  "resource",
] as const;
export type SecretLogicalScope = (typeof SECRET_SCOPES)[number];

export type SecretPointer = {
  id: string;
  organizationId: string;
  provider: SecretProvider;
  providerPath: string;
  providerKey: string;
  providerVersion: string | null;
  kind: SecretKind;
};

export type UpsertSecretInput = {
  organizationId: string;
  kind: SecretKind;
  logicalScope: SecretLogicalScope;
  logicalScopeId: string;
  key: string;
  plaintext: string;
  actorUserId: string;
};

export type RevealSecretInput = {
  secretRefId: string;
  reason: string;
  actorUserId: string;
  requireStepUp: true;
};
