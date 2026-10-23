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
}

export interface OpRequest {
  action: string;
  confirm?: boolean;
  params?: OpParams;
}

export interface OpResult {
  action: string;
  argv: string[];
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

/**
 * Build the argv for one structural operation. Pure: no spawning, no state, so
 * the client-facing allowlist can be unit-tested without a repository.
 *
 * `confirm` is checked here as well as in the service, so a direct caller cannot
 * bypass the confirmation gate by calling the builder.
 */
export function buildOpArgv(request: OpRequest): string[] {
  const action = request.action;
  const params = request.params ?? {};
  let argv: string[];
  switch (action) {
    case "new": {
      const onto = rev(params.onto, "onto");
      argv = ["new", onto];
      if (params.message !== undefined) argv.push("-m", text(params.message, "message"));
      break;
    }
    case "edit":
      argv = ["edit", change(params.change, "change")];
      break;
    case "describe": {
      const target = change(params.change, "change");
      const message = text(params.message ?? "", "message");
      argv = ["describe", "-r", target, "-m", message];
      break;
    }
    case "squash": {
      const from = change(params.from ?? params.change, "from");
      // -u keeps the destination description; without it jj opens an editor.
      if (params.into === undefined) {
        argv = ["squash", "-r", from, "-u"];
      } else {
        argv = ["squash", "--from", from, "--into", change(params.into, "into"), "-u"];
      }
      break;
    }
    case "abandon": {
      const target = change(params.change, "change");
      argv = ["abandon", params.subtree === true ? `${target}::` : target];
      break;
    }
    case "duplicate": {
      argv = ["duplicate", change(params.change, "change")];
      if (params.onto !== undefined) argv.push("--onto", rev(params.onto, "onto"));
      break;
    }
    case "revert": {
      argv = [
        "revert",
        "-r",
        change(params.change, "change"),
        "--onto",
        rev(params.destination ?? params.onto, "destination")
      ];
      break;
    }
    case "rebase": {
      argv = [
        "rebase",
        "-r",
        change(params.change, "change"),
        "--onto",
        rev(params.destination ?? params.onto, "destination")
      ];
      break;
    }
    case "split": {
      const paths = params.paths;
      if (!Array.isArray(paths) || paths.length === 0) {
        throw new JjError("invalid-path", "split needs at least one path");
      }
      const safe = paths.map((path) => {
        if (!isSafePath(path)) throw new JjError("invalid-path", path);
        return path;
      });
      // -m keeps the split non-interactive; without it jj opens an editor.
      argv = [
        "split",
        "-r",
        change(params.change, "change"),
        "-m",
        text(params.message ?? "split", "message"),
        ...safe
      ];
      break;
    }
    case "undo":
      argv = ["undo"];
      break;
    case "fetch":
      argv = ["git", "fetch"];
      break;
    case "bookmark":
      argv = ["bookmark", "set", bookmark(params.name), "-r", rev(params.change, "change")];
      break;
    case "push":
      argv = ["git", "push", "--bookmark", bookmark(params.name)];
      break;
    default:
      throw new JjError("unknown-action", action);
  }
  if (DESTRUCTIVE.has(action) && request.confirm !== true) {
    throw new JjError("confirmation-required", argv.join(" "));
  }
  return argv;
}

/** Execute one structural operation through the shared runner. */
export async function runOp(runner: Runner, root: string, request: OpRequest): Promise<OpResult> {
  const argv = buildOpArgv(request);
  const result = await runner.run(argv, { cwd: root });
  if (result.code === -1 && /ENOENT/iu.test(result.err)) {
    throw new JjError("jj-missing", "jj executable not found");
  }
  if (result.code !== 0) {
    throw new JjError("jj-error", result.err.trim() || `jj exited ${String(result.code)}`);
  }
  if (result.truncated) throw new JjError("truncated", "jj output exceeded the configured cap");
  return { action: request.action, argv, stdout: result.out };
}
