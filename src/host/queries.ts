import type { Runner } from "./jj.js";
import { parseJsonObject, parseLog, parseSummary } from "./parser.js";
import type { JjCommit, JjDiffResult, JjFileChange, JjShowResult, JjSnapshot } from "./types.js";

const TAB = '"\\t"';
const NL = '"\\n"';

/** changeId, commitId, parents, bookmarks, tags, empty, conflict, divergent, subject */
export const LOG_TEMPLATE = [
  "self.change_id().shortest(12)",
  TAB,
  "self.commit_id().shortest(12)",
  TAB,
  'self.parents().map(|p| p.commit_id().shortest(12)).join(" ")',
  TAB,
  'self.bookmarks().map(|b| b.name()).join(",")',
  TAB,
  'self.tags().map(|t| t.name()).join(",")',
  TAB,
  "self.empty()",
  TAB,
  "self.conflict()",
  TAB,
  "self.divergent()",
  TAB,
  "self.description().first_line()",
  NL
].join(" ++ ");

export class JjError extends Error {
  readonly code: string;
  readonly stderr: string;

  constructor(code: string, message: string, stderr = "") {
    super(message);
    this.name = "JjError";
    this.code = code;
    this.stderr = stderr;
  }
}

async function exec(runner: Runner, cwd: string, argv: string[], maxBytes?: number): Promise<string> {
  const result = await runner.run(argv, { cwd, ...(maxBytes === undefined ? {} : { maxBytes }) });
  if (result.code === -1 && /ENOENT/iu.test(result.err)) {
    throw new JjError("jj-missing", "jj executable not found");
  }
  if (result.code !== 0) {
    throw new JjError("jj-error", result.err.trim() || `jj exited ${String(result.code)}`, result.err);
  }
  if (result.truncated) {
    throw new JjError("truncated", "jj output exceeded the configured cap");
  }
  return result.out;
}

function commitFromJson(value: Record<string, unknown>): JjCommit {
  const author = value["author"] as Record<string, unknown> | undefined;
  const parents = Array.isArray(value["parents"]) ? (value["parents"] as unknown[]).map(String) : [];
  return {
    changeId: String(value["change_id"] ?? "").slice(0, 12),
    commitId: String(value["commit_id"] ?? "").slice(0, 12),
    parents: parents.map((parent) => parent.slice(0, 12)),
    bookmarks: [],
    tags: [],
    empty: false,
    conflict: false,
    divergent: false,
    subject: String(value["description"] ?? "").split("\n")[0] ?? "",
    // keep author reachable for callers that want it later
    ...(author === undefined ? {} : {})
  };
}

export async function snapshot(runner: Runner, cwd: string): Promise<JjSnapshot> {
  const root = (await exec(runner, cwd, ["root"])).trim();
  const version = (await exec(runner, cwd, ["--version"])).trim();
  let current: JjCommit | null = null;
  try {
    const raw = await exec(runner, root, ["log", "-r", "@", "--no-graph", "-T", "json(self)"]);
    current = commitFromJson(parseJsonObject(raw));
  } catch {
    current = null;
  }
  return { root, version, current, bookmarks: [], tags: [] };
}

export async function log(
  runner: Runner,
  root: string,
  revset: string,
  limit: number
): Promise<JjCommit[]> {
  const out = await exec(runner, root, [
    "log",
    "-r",
    revset,
    "--no-graph",
    "-n",
    String(limit),
    "-T",
    LOG_TEMPLATE
  ]);
  return parseLog(out);
}

export async function show(runner: Runner, root: string, change: string): Promise<JjShowResult> {
  const raw = await exec(runner, root, ["show", change, "--no-patch", "-T", "json(self)"]);
  const meta = parseJsonObject(raw);
  const summary = await exec(runner, root, ["diff", "-r", change, "--summary"]);
  const files: JjFileChange[] = parseSummary(summary);
  const author = (meta["author"] ?? {}) as Record<string, unknown>;
  const committer = (meta["committer"] ?? {}) as Record<string, unknown>;
  return {
    commit: commitFromJson(meta),
    message: String(meta["description"] ?? ""),
    author: {
      name: String(author["name"] ?? ""),
      email: String(author["email"] ?? ""),
      timestamp: String(author["timestamp"] ?? "")
    },
    committer: {
      name: String(committer["name"] ?? ""),
      email: String(committer["email"] ?? ""),
      timestamp: String(committer["timestamp"] ?? "")
    },
    files
  };
}

export async function diff(
  runner: Runner,
  root: string,
  change: string,
  path: string
): Promise<JjDiffResult> {
  const patch = await exec(runner, root, ["diff", "-r", change, "--git", "--", path]);
  return { patch, truncated: false };
}
