/** Input validation for values that end up on a jj command line unchanged. */

const REVSET_ALLOWED = /^[\w@.:/|&~()'",=+* \-]+$/u;

/** A revset is a small expression language, not a place for global flags. */
export function isSafeRevset(value: string): boolean {
  if (value === "" || value.length > 300) return false;
  if (value.startsWith("-")) return false;
  if (value.includes("--")) return false;
  return REVSET_ALLOWED.test(value);
}

/** A repository-relative path; absolute paths and traversal are rejected. */
export function isSafePath(value: string): boolean {
  if (value === "" || value.includes("\0")) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  if (/^[A-Za-z]:/u.test(value)) return false;
  const segments = value.split(/[\\/]+/u);
  return segments.every((segment) => segment !== "..");
}

export function isSafeChange(value: string): boolean {
  return value !== "" && value.length <= 120 && !value.startsWith("-") && !/[\0\n\r]/u.test(value);
}
