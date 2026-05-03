import { VariablesTable } from "@/features/project-variables";

export function VariablesTab() {
  return (
    <div className="p-4">
      <VariablesTable scope="resource" />
    </div>
  );
}
