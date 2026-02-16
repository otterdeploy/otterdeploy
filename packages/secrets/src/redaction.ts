export function redactSecretValue(value: string, visibleSuffix = 4) {
  if (value.length <= visibleSuffix) {
    return "*".repeat(Math.max(8, value.length));
  }

  return `${"*".repeat(Math.max(8, value.length - visibleSuffix))}${value.slice(-visibleSuffix)}`;
}
