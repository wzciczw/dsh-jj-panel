/** Pure editing helpers: RPC payloads, graph ancestry, drop plans, menu state. */
import type { Commit } from "./types";

/** Param block accepted by the host `op` method (see src/host/ops.ts). */
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
  mode?: "onto" | "before" | "after";
}

export interface OpCall {
  action: string;
  params?: OpParams;
  confirm?: boolean;
}

export interface RpcErrorInfo {
  code: string;
  message?: string;
}

/** Host actions that refuse to run without `confirm: true`. */
const CONFIRM_REQUIRED = new Set(["abandon", "revert", "undo", "push"]);

export function opNeedsConfirm(action: string): boolean {
  return CONFIRM_REQUIRED.has(action);
}

/**
 * Build the `req` payload for `jjPanel/op`. Optional fields are omitted rather
 * than sent as `undefined`, so the gateway sees exactly the documented shape.
 */
export function opPayload(sessionId: string | undefined, call: OpCall): Record<string, unknown> {
  const payload: Record<string, unknown> = { sessionId, action: call.action };
  if (call.confirm === true) payload["confirm"] = true;
  if (call.params !== undefined) payload["params"] = call.params;
  return payload;
}

/** Render a failed RPC as `code: message`, verbatim, for the status line. */
export function formatError(error: RpcErrorInfo): string {
  const message = error.message === undefined ? "" : error.message.trim();
  return message === "" ? error.code : `${error.code}: ${message}`;
}

/** A concrete next action for the error codes the host can return. */
export function errorHintKey(code: string): string | null {
  switch (code) {
    case "not-a-repo":
      return "hintNotRepo";
    case "jj-missing":
      return "hintJjMissing";
    case "cwd-unavailable":
      return "hintCwd";
    case "no-connection":
      return "hintNoConnection";
    case "truncated":
      return "hintTruncated";
    default:
      return null;
  }
}

/** Status line text for a successful `op`: jj stdout, or `<action> ok`. */
export function formatOpResult(result: { action: string; stdout: string }): string {
  const stdout = result.stdout.trim();
  return stdout === "" ? `${result.action} ok` : stdout;
}

export function findCommit(commits: readonly Commit[], changeId: string): Commit | undefined {
  return commits.find((commit) => commit.changeId === changeId);
}

export function commitById(commits: readonly Commit[], commitId: string): Commit | undefined {
  return commits.find((commit) => commit.commitId === commitId);
}

/**
 * True when `commitId` is `ancestorCommitId` or has it on its parent chain.
 * Parents are commit ids, so this walks commit ids, never change ids.
 */
export function isDescendant(
  commits: readonly Commit[],
  commitId: string,
  ancestorCommitId: string
): boolean {
  const byId = new Map(commits.map((commit) => [commit.commitId, commit]));
  const seen = new Set<string>();
  const stack: string[] = [commitId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) continue;
    if (id === ancestorCommitId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const commit = byId.get(id);
    if (commit === undefined) continue;
    for (const parent of commit.parents) {
      if (!seen.has(parent)) stack.push(parent);
    }
  }
  return false;
}

export const TRUNK_BOOKMARKS = ["main", "master"] as const;

/** `main`, `master`, and their remote-tracking forms (`main@origin`). */
export function isTrunkBookmark(name: string): boolean {
  const base = name.split("@")[0] ?? name;
  return (TRUNK_BOOKMARKS as readonly string[]).includes(base);
}

/** The main bookmark's change, falling back to master (including remotes). */
export function trunkChangeId(commits: readonly Commit[]): string | null {
  for (const name of TRUNK_BOOKMARKS) {
    const exact = commits.find((commit) => commit.bookmarks.includes(name));
    if (exact !== undefined) return exact.changeId;
  }
  const remote = commits.find((commit) => commit.bookmarks.some(isTrunkBookmark));
  return remote === undefined ? null : remote.changeId;
}

export type RebaseDrop =
  | { ok: true; destination: string; mode: "onto" | "before" }
  | { ok: false; reason: "self" | "descendant" | "no-parent" | "missing" };

export interface RebaseOptions {
  /** Alt-drop: insert the dragged change directly before the drop target (reorder). */
  alt?: boolean;
}

/**
 * Decide where a row dropped on `targetChangeId` should rebase to. A plain drop
 * makes the dragged change a child of the target; Alt inserts it before the
 * target, which reorders a stack. Drops onto the change itself or onto one of
 * its descendants would create a cycle and are rejected before any RPC is sent.
 */
export function planRebaseDrop(
  commits: readonly Commit[],
  sourceChangeId: string,
  targetChangeId: string,
  options: RebaseOptions = {}
): RebaseDrop {
  const source = findCommit(commits, sourceChangeId);
  const target = findCommit(commits, targetChangeId);
  if (source === undefined || target === undefined) return { ok: false, reason: "missing" };
  if (source.changeId === target.changeId) return { ok: false, reason: "self" };
  const destination = target;
  if (destination.commitId === source.commitId) return { ok: false, reason: "self" };
  const mode: "onto" | "before" = options.alt === true ? "before" : "onto";
  // `onto` makes the source a child of the destination; `before` makes the
  // source the destination's parent. Each direction has its own cycle check.
  const cycle =
    mode === "onto"
      ? isDescendant(commits, destination.commitId, source.commitId)
      : isDescendant(commits, source.commitId, destination.commitId);
  if (cycle) return { ok: false, reason: "descendant" };
  return { ok: true, destination: destination.changeId, mode };
}

/** Move one row up/down; clamps at the ends and recovers from a stale id. */
export function nextSelection(
  commits: readonly Commit[],
  currentChangeId: string | null,
  delta: number
): string | null {
  if (commits.length === 0) return null;
  const index =
    currentChangeId === null
      ? -1
      : commits.findIndex((commit) => commit.changeId === currentChangeId);
  if (index === -1) {
    const fallback = delta >= 0 ? commits[0] : commits[commits.length - 1];
    return fallback === undefined ? null : fallback.changeId;
  }
  const next = Math.min(commits.length - 1, Math.max(0, index + delta));
  const commit = commits[next];
  return commit === undefined ? null : commit.changeId;
}

export type MenuActionId =
  | "new"
  | "edit"
  | "describe"
  | "squash"
  | "abandon"
  | "abandon-subtree"
  | "duplicate"
  | "revert"
  | "split"
  | "copy"
  | "push";

export interface MenuItemDef {
  id: MenuActionId;
  labelKey: string;
  destructive: boolean;
  visible: boolean;
  enabled: boolean;
}

export interface MenuContext {
  commit: Commit;
  currentChangeId: string | null;
  busy?: boolean;
}

/**
 * Which context-menu entries apply to a change. `jj edit` and `jj duplicate`
 * work on any change; squash needs a parent, split needs local changes, revert
 * needs something other than the working copy, and push needs a bookmark.
 */
export function menuItems(context: MenuContext): MenuItemDef[] {
  const { commit, currentChangeId } = context;
  const busy = context.busy === true;
  const isCurrent = currentChangeId !== null && currentChangeId === commit.changeId;
  const hasParent = commit.parents.length > 0;
  return [
    { id: "new", labelKey: "menuNew", destructive: false, visible: true, enabled: !busy },
    { id: "edit", labelKey: "menuEdit", destructive: false, visible: true, enabled: !busy },
    { id: "describe", labelKey: "menuDescribe", destructive: false, visible: true, enabled: !busy },
    {
      id: "squash",
      labelKey: "menuSquash",
      destructive: false,
      visible: true,
      enabled: !busy && hasParent
    },
    { id: "abandon", labelKey: "menuAbandon", destructive: true, visible: true, enabled: !busy },
    {
      id: "abandon-subtree",
      labelKey: "menuAbandonSubtree",
      destructive: true,
      visible: true,
      enabled: !busy
    },
    { id: "duplicate", labelKey: "menuDuplicate", destructive: false, visible: true, enabled: !busy },
    {
      id: "revert",
      labelKey: "menuRevert",
      destructive: true,
      visible: true,
      enabled: !busy && !isCurrent
    },
    {
      id: "split",
      labelKey: "menuSplit",
      destructive: false,
      visible: true,
      // Splitting creates a child of @; only the working-copy change can split.
      enabled: !busy && !commit.empty && isCurrent
    },
    {
      id: "copy",
      labelKey: "menuCopy",
      destructive: false,
      visible: true,
      enabled: !busy && commit.changeId !== ""
    },
    {
      id: "push",
      labelKey: "menuPush",
      destructive: true,
      visible: commit.bookmarks.length > 0,
      enabled: !busy
    }
  ];
}
