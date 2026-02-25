export interface RedactionFilter {
  redact(text: string): string;
}

const COMMON_SECRET_PATTERNS: RegExp[] = [
  // AWS access keys
  /AKIA[0-9A-Z]{16}/g,
  // JWT tokens
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // Bearer tokens
  /Bearer [A-Za-z0-9._~+/=-]+/g,
  // Basic auth in URLs
  /:\/\/[^:]+:[^@]+@/g,
];

/**
 * Create a redaction filter that replaces known secret values and common
 * secret patterns with [REDACTED].
 */
export function createRedactionFilter(secretValues: string[]): RedactionFilter {
  const literals = secretValues.filter((v) => v.length > 0);

  return {
    redact(text: string): string {
      let result = text;

      for (const secret of literals) {
        while (result.includes(secret)) {
          result = result.replace(secret, "[REDACTED]");
        }
      }

      for (const pattern of COMMON_SECRET_PATTERNS) {
        const regex = new RegExp(pattern.source, pattern.flags);
        result = result.replace(regex, "[REDACTED]");
      }

      return result;
    },
  };
}
