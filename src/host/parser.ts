import type { JjCommit, JjFileChange } from "./types.js";

/** Tab-separated fields produced by the log template, in declaration order. */
const LOG_FIELDS = 9;

/**
 * Parse one `jj log -T <template>` dump. The description is last and may
 * contain tabs, so the final field absorbs everything after the 8th tab.
 */
export function parseLog(out: string): JjCommit[] {
  const commits: JjCommit[] = [];
  for (const line of out.split("\n")) {
    if (line === "") continue;
    const parts = line.split("\t");
    if (parts.length < LOG_FIELDS) {
      throw new Error(`unexpected jj log line (${parts.length} fields): ${line.slice(0, 160)}`);
    }
    const [changeId = "", commitId = "", parents = "", bookmarks = "", tags = "", empty = "", conflict = "", divergent = ""] = parts;
    const subject = parts.slice(LOG_FIELDS - 1).join("\t");
    commits.push({
      changeId,
      commitId,
      parents: parents.split(/\s+/u).filter((value) => value !== ""),
      bookmarks: bookmarks.split(",").filter((value) => value !== ""),
      tags: tags.split(",").map((value) => value.replace(/^"|"$/gu, "")).filter((value) => value !== ""),
      empty: empty === "true",
      conflict: conflict === "true",
      divergent: divergent === "true",
      subject
    });
  }
  return commits;
}

/** `jj diff --summary` lines look like `M path/to/file` or `R old => new`. */
export function parseSummary(out: string): JjFileChange[] {
  const files: JjFileChange[] = [];
  for (const line of out.split("\n")) {
    if (line.trim() === "") continue;
    const status = line.slice(0, 1);
    const rest = line.slice(1).trimStart();
    if (rest === "") continue;
    const path = rest.includes(" => ") ? rest.split(" => ").pop() ?? rest : rest;
    files.push({ status, path });
  }
  return files;
}

/** jj prints one compact JSON object per record; a single record parses directly. */
export function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (trimmed === "") throw new Error("empty jj output");
  const value: unknown = JSON.parse(trimmed);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("unexpected jj JSON output");
  }
  return value as Record<string, unknown>;
}

/** Parse `name<TAB>target` lines produced by the bookmark/tag templates. */
export function parseRefs(out: string): { name: string; target: string }[] {
  const refs: { name: string; target: string }[] = [];
  for (const line of out.split("\n")) {
    if (line === "") continue;
    const [name = "", target = ""] = line.split("\t");
    if (name !== "") refs.push({ name, target });
  }
  return refs;
}
