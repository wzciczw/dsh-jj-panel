/** Input validation for values that end up on a jj command line unchanged. */

const REVSET_ALLOWED = /^[\w@.:/|&~()'",=+* \-]+$/u;

/** A revset is a small expression language, not a place for global flags. */
export function isSafeRevset(value: string): boolean {
  if (value === "" || value.length > 300) return false;
  // A leading dash, or any whitespace-separated token starting with one, could
  // be parsed as an option by jj; reject the whole value.
  if (value.startsWith("-") || /(^|\s)-/u.test(value)) return false;
  return REVSET_ALLOWED.test(value);
}

/** A repository-relative path; absolute paths, traversal and options are rejected. */
export function isSafePath(value: string): boolean {
  if (value === "" || value.includes("\0")) return false;
  if (value.startsWith("-")) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  if (/^[A-Za-z]:/u.test(value)) return false;
  const segments = value.split(/[\\/]+/u);
  return segments.every((segment) => segment !== "..");
}

/** A change id (jj uses short lowercase ids) or the working-copy symbol. */
export function isSafeChange(value: string): boolean {
  return value === "@" || /^[a-z0-9]{1,40}$/u.test(value);
}
