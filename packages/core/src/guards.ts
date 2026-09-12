/**
 * Checks whether a value is a non-null object (may or may not be an array).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Checks whether a value is a non-null, non-array object.
 */
export function isStrictRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
