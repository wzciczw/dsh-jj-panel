import type { Runner } from "./jj.js";
import { JjError } from "./queries.js";
import { isSafeChange, isSafePath, isSafeRevset } from "./validate.js";

export interface OpParams {
  onto?: string;
  change?: string;
  destination?: string;
  message?: string;
  from?: string;
  into?: string;
  paths?: string[];
  name?: string;
  subtree?: boolean;
  /** rebase placement: child of the destination (default), or adjacent insertion. */
  mode?: "onto" | "before" | "after";
}

export interface OpRequest {
  action: string;
  confirm?: boolean;
  params?: OpParams;
}

export interface OpResult {
  action: string;
  steps: string[][];
  stdout: string;
}

/** Actions whose effect is hard to recover without an explicit undo. */
const DESTRUCTIVE = new Set(["abandon", "revert", "undo", "push"]);

const BOOKMARK = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const MESSAGE_MAX = 10000;

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.includes("\0") || value.length > MESSAGE_MAX) {
    throw new JjError("invalid-param", `${field} must be a string without NUL characters`);
  }
  return value;
}

function rev(value: unknown, field: string): string {
  if (typeof value !== "string" || !isSafeRevset(value)) {
    throw new JjError("invalid-revset", `${field}: ${String(value)}`);
  }
  return value;
}

function change(value: unknown, field: string): string {
  if (typeof value !== "string" || !isSafeChange(value)) {
    throw new JjError("invalid-change", `${field}: ${String(value)}`);
  }
  return value;
}

function bookmark(value: unknown): string {
  if (typeof value !== "string" || !BOOKMARK.test(value) || value.startsWith("-")) {
    throw new JjError("invalid-bookmark", String(value));
  }
  return value;
}

function filesets(paths: unknown): string[] {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new JjError("invalid-path", "needs at least one path");
  }
  return paths.map((path) => {
    if (typeof path !== "string" || path.startsWith("-") || !isSafePath(path)) {
      throw new JjError("invalid-path", String(path));
    }
    return path;
  });
}

/**
 * Build the argv sequence for one structural operation. Pure: no spawning, no
 * state, so the allowlist and every flag can be unit-tested without a repo.
 *
 * Most actions are one step. `split` is a composite that creates an empty child
 * of the current change, moves the selected paths into it with `jj squash`, and
 * describes it; the service additionally checks that the target is `@`.
 */
export function buildOpSteps(request: OpRequest): string[][] {
  const action = request.action;
  const params = request.params ?? {};
  let steps: string[][];
  switch (action) {
    case "new": {
      const onto = rev(params.onto, "onto");
      const argv = ["new", onto];
      if (params.message !== undefined) argv.push(`--message=${text(params.message, "message")}`);
      steps = [argv];
      break;
    }
    case "edit":
      steps = [["edit", change(params.change, "change")]];
      break;
    case "describe":
      steps = [
        [
          "describe",
          "-r",
          change(params.change, "change"),
          `--message=${text(params.message ?? "", "message")}`
        ]
      ];
      break;
    case "squash": {
      const from = change(params.from ?? params.change, "from");
      // -u keeps the destination description; without it jj opens an editor.
      steps =
        params.into === undefined
          ? [["squash", "-r", from, "-u"]]
          : [["squash", "--from", from, "--into", rev(params.into, "into"), "-u"]];
      break;
    }
    case "abandon": {
      const target = change(params.change, "change");
      steps = [["abandon", params.subtree === true ? `${target}::` : target]];
      break;
    }
    case "duplicate": {
      const argv = ["duplicate", change(params.change, "change")];
      if (params.onto !== undefined) argv.push("--onto", rev(params.onto, "onto"));
      steps = [argv];
      break;
    }
    case "revert": {
      // Insert before @ so the revert change stays inside the visible `@` stack.
      steps = [
        [
          "revert",
          "-r",
          change(params.change, "change"),
          "--insert-before",
          rev(params.destination ?? "@", "destination")
        ]
      ];
      break;
    }
    case "rebase": {
      const target = rev(params.destination ?? params.onto, "destination");
      const flag =
        params.mode === "before" ? "--insert-before" : params.mode === "after" ? "--insert-after" : "--onto";
      steps = [["rebase", "-r", change(params.change, "change"), flag, target]];
      break;
    }
    case "split": {
      const paths = filesets(params.paths);
      const message = text(params.message ?? "split", "message");
      steps = [
        ["new"],
        ["squash", "--from", "@-", "--into", "@", "-u", "--", ...paths],
        ["describe", "-r", "@", `--message=${message}`]
      ];
      break;
    }
    case "undo":
      steps = [["undo"]];
      break;
    case "fetch":
      steps = [["git", "fetch"]];
      break;
    case "bookmark":
      steps = [["bookmark", "set", bookmark(params.name), "-r", rev(params.change, "change")]];
      break;
    case "push":
      steps = [["git", "push", "--bookmark", bookmark(params.name)]];
      break;
    default:
      throw new JjError("unknown-action", action);
  }
  if (DESTRUCTIVE.has(action) && request.confirm !== true) {
    throw new JjError("confirmation-required", steps[0]?.join(" ") ?? action);
  }
  return steps;
}

/** First step of the plan; kept for callers that only need one argv. */
export function buildOpArgv(request: OpRequest): string[] {
  return buildOpSteps(request)[0] ?? [];
}

async function assertSplitTarget(runner: Runner, root: string, request: OpRequest): Promise<void> {
  const target = request.params?.change ?? "";
  if (target === "@") return;
  const result = await runner.run(["log", "-r", "@", "--no-graph", "-T", "change_id.short(12)"], {
    cwd: root
  });
  if (result.code !== 0) {
    throw new JjError("jj-error", result.err.trim() || "cannot resolve @");
  }
  if (result.out.trim() !== target) {
    throw new JjError("split-only-current", `split moves the working copy; select @ (${result.out.trim()})`);
  }
}

/** Execute one structural operation through the shared runner. */
export async function runOp(runner: Runner, root: string, request: OpRequest): Promise<OpResult> {
  const steps = buildOpSteps(request);
  if (request.action === "split") await assertSplitTarget(runner, root, request);
  let stdout = "";
  for (const argv of steps) {
    const result = await runner.run(argv, { cwd: root });
    if (result.code === -1 && /ENOENT/iu.test(result.err)) {
      throw new JjError("jj-missing", "jj executable not found");
    }
    if (result.code !== 0) {
      throw new JjError("jj-error", result.err.trim() || `jj exited ${String(result.code)}`);
    }
    if (result.truncated) throw new JjError("truncated", "jj output exceeded the configured cap");
    if (result.out.trim() !== "") stdout = result.out;
  }
  return { action: request.action, steps, stdout };
}
