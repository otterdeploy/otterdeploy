export type EnvName = "development" | "staging" | "production";

export interface EnvOption {
  name: EnvName;
  label: string;
  color: "emerald" | "amber" | "rose";
}

export const envOptions: ReadonlyArray<EnvOption> = [
  { name: "development", label: "Dev", color: "emerald" },
  { name: "staging", label: "Staging", color: "amber" },
  { name: "production", label: "Prod", color: "rose" },
];
