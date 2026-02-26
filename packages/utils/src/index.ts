import { createId as cuid2 } from "@paralleldrive/cuid2";

export function createId(): string {
  return cuid2();
}
