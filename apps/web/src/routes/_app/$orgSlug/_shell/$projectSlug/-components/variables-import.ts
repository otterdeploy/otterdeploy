/**
 * Drag-drop .env import + export helpers for the per-env variables table.
 * Pure file plumbing — parsing/serializing lives in `variables-dotenv.ts`.
 */
import { toast } from "sonner";

import { serializeDotEnv } from "./variables-dotenv";

/** Drag-drop .env imports above this size are refused with an honest toast. */
const MAX_IMPORT_BYTES = 512 * 1024;

function isEnvLikeFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".env") ||
    name.endsWith(".txt") ||
    name.startsWith(".env") || // .env, .env.local, .env.production…
    file.type === "text/plain"
  );
}

/** True when the drag payload contains OS files (not in-page drags). */
export function hasFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes("Files");
}

/** Validate + read a dropped .env file. Returns its text, or null after
 *  toasting why the import was refused. */
export async function readEnvImport(file: File): Promise<string | null> {
  if (!isEnvLikeFile(file)) {
    toast.error(`Can't import ${file.name} — drop a .env or .txt file.`);
    return null;
  }
  if (file.size > MAX_IMPORT_BYTES) {
    toast.error(
      `${file.name} is ${Math.ceil(file.size / 1024)} KB — imports are capped at ${MAX_IMPORT_BYTES / 1024} KB.`,
    );
    return null;
  }
  try {
    return await file.text();
  } catch {
    toast.error(`Couldn't read ${file.name}.`);
    return null;
  }
}

/** Explicit export: always writes real values regardless of the masked
 *  state — the reveal toggle only affects on-screen rendering. */
export function downloadDotEnvFile(
  rows: { key: string; value: string }[],
  filename: string,
): void {
  const content = serializeDotEnv(rows.map((r) => ({ key: r.key, value: r.value })));
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
