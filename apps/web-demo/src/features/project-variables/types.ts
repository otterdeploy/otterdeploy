export type VariableScope = "project" | "resource";

export interface VariableRow {
  key: string;
  /** Always returned masked from the API (e.g. "sk_***"). Plan 6 ships reveal-on-demand. */
  maskedValue: string;
  referencedBy: ReadonlyArray<{ kind: "service" | "database"; name: string }>;
}
