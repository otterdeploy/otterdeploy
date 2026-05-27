/**
 * External secret-manager picker (Infisical / Vault / AWS SM).
 *
 * The wizard no longer renders this — none of those integrations
 * exist on the server side and the original mock dropdown was
 * showing a fictitious "paperhouse" org. Kept as a no-op component
 * so the form hook's field registry stays satisfied without a wider
 * schema refactor; when an integration ships this is where its
 * picker lives.
 */

export function LinkedSecretsField() {
  return null;
}
