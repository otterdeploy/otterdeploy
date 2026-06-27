import { orpc } from "@/shared/server/orpc";

export type EdgeLogsData = Awaited<ReturnType<typeof orpc.edgeLogs.query.call>>;
export type EdgeLog = EdgeLogsData["rows"][number];

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const BUCKETS = ["2xx", "3xx", "4xx", "5xx"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const BUCKET_BG: Record<Bucket, string> = {
  "2xx": "bg-success",
  "3xx": "bg-sky-500",
  "4xx": "bg-amber-500",
  "5xx": "bg-destructive",
};
export const BUCKET_TEXT: Record<Bucket, string> = {
  "2xx": "text-success",
  "3xx": "text-sky-500",
  "4xx": "text-amber-500",
  "5xx": "text-destructive",
};
export const METHOD_TEXT: Record<string, string> = {
  GET: "text-sky-500",
  POST: "text-success",
  PUT: "text-amber-500",
  PATCH: "text-amber-500",
  DELETE: "text-destructive",
};

export function statusBucket(s: number): Bucket {
  if (s >= 500) return "5xx";
  if (s >= 400) return "4xx";
  if (s >= 300) return "3xx";
  return "2xx";
}
