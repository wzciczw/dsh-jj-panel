import * as React from "react";
import { layoutGraph, type GraphRow } from "./graph";
import {
  errorHintKey,
  findCommit,
  formatError,
  formatOpResult,
  isTrunkBookmark,
  menuItems,
  nextSelection,
  opNeedsConfirm,
  opPayload,
  planRebaseDrop,
  trunkChangeId,
  type MenuActionId,
  type OpCall
} from "./ops";
import type { Commit, Rpc, RpcResponse, ShowData, Snapshot } from "./types";

const NS = "jj-panel";

type Translate = (key: string, vars?: Record<string, unknown>) => string;

/**
 * The gateway wraps the Remote method's return value in its own { ok, value }
 * envelope, and the service answers with an { ok, value } result as well, so a
 * call reads as response.value = { ok, value }. Flatten exactly that shape.
 */
function unwrap<T>(
  response: RpcResponse<unknown>
): { ok: true; value: T } | { ok: false; error: { code: string; message?: string } } {
  if (!response.ok) {
    const error = response.error;
    return {
      ok: false,
      error: {
        code: error?.code ?? "error",
        ...(error?.message === undefined ? {} : { message: error.message })
      }
    };
  }
  const inner = response.value as
    | { ok?: boolean; value?: T; error?: { code?: string; message?: string } }
    | undefined;
  if (inner === undefined || inner.ok !== true) {
    const error = inner?.error;
    return {
      ok: false,
      error: {
        code: error?.code ?? "malformed-response",
        ...(error?.message === undefined ? {} : { message: error.message })
      }
    };
  }
  return { ok: true, value: inner.value as T };
}

const STRINGS = {
  zh: {
    tab: "Jujutsu",
    refresh: "刷新",
    revset: "revset",
    empty: "当前工作区没有可显示的 change",
    loading: "加载中…",
    select: "选择一个 change 查看详情",
    files: "改动文件",
    noFiles: "该 change 没有改动文件",
    changeId: "change",
    commitId: "commit",
    author: "作者",
    error: "加载失败",
    diff: "差异",
    noDescription: "(无描述)",
    actions: "更多操作",
    undo: "撤销",
    fetch: "拉取",
    menuNew: "在此新建 change",
    menuEdit: "编辑此 change",
    menuDescribe: "修改描述…",
    menuSquash: "压缩进父 change",
    menuAbandon: "放弃 change",
    menuAbandonSubtree: "放弃整棵子树",
    menuDuplicate: "复制 change",
    menuRevert: "回滚到 @",
    menuSplit: "按文件拆分…",
    menuCopy: "复制 change id",
    menuPush: "推送 bookmark…",
    describeTitle: "修改描述",
    save: "保存",
    cancel: "取消",
    confirm: "确认执行",
    action: "操作",
    target: "目标 change",
    bookmark: "bookmark",
    editDescription: "编辑描述",
    splitByFile: "按文件拆分",
    splitIntoNew: "拆分到新 change",
    splitOnlyCurrent: "只能拆分当前 @ change（拆分会在它下面新建 change 并移动工作副本）",
    restartRequired: "host 半尚未加载：重启一次 DSH 后再试（浏览器半已热更新）",
    selectedFiles: "已选文件",
    close: "关闭",
    copied: "已复制",
    copyFailed: "复制失败",
    dropRejected: "无法放置",
    hintNotRepo: "当前目录不是 jj 仓库：先运行 jj git init --colocate，或切换会话目录。",
    hintJjMissing: "找不到 jj 可执行文件：安装 jj，或在插件配置里设置 jjPath。",
    hintCwd: "会话工作目录不可用：确认该会话已绑定到一个存在的目录。",
    hintNoConnection: "没有 RPC 连接：重新加载页面，或重启 DSH。",
    hintTruncated: "jj 输出超过上限：缩小 revset 范围再试。"
  },
  en: {
    tab: "Jujutsu",
    refresh: "Refresh",
    revset: "revset",
    empty: "No changes to show in this workspace",
    loading: "Loading…",
    select: "Select a change to see details",
    files: "Changed files",
    noFiles: "This change has no changed files",
    changeId: "change",
    commitId: "commit",
    author: "Author",
    error: "Failed to load",
    diff: "Diff",
    noDescription: "(no description)",
    actions: "More actions",
    undo: "Undo",
    fetch: "Fetch",
    menuNew: "New change here",
    menuEdit: "Edit this change",
    menuDescribe: "Describe…",
    menuSquash: "Squash into parent",
    menuAbandon: "Abandon",
    menuAbandonSubtree: "Abandon subtree",
    menuDuplicate: "Duplicate",
    menuRevert: "Revert onto @",
    menuSplit: "Split by file…",
    menuCopy: "Copy change id",
    menuPush: "Push bookmark…",
    describeTitle: "Edit description",
    save: "Save",
    cancel: "Cancel",
    confirm: "Confirm",
    action: "Action",
    target: "Target change",
    bookmark: "Bookmark",
    editDescription: "Edit description",
    splitByFile: "Split by file",
    splitIntoNew: "Split into new change",
    splitOnlyCurrent: "Only the current @ change can split (it creates a child and moves the working copy)",
    restartRequired: "Host half not loaded yet: restart DSH once and retry (the browser half hot-reloaded)",
    selectedFiles: "Selected files",
    close: "Close",
    copied: "Copied",
    copyFailed: "Copy failed",
    dropRejected: "Cannot drop",
    hintNotRepo: "This directory is not a jj repository: run jj git init --colocate or switch the session directory.",
    hintJjMissing: "jj was not found: install jj or set jjPath in the plugin config.",
    hintCwd: "The session working directory is unavailable: make sure the session is bound to an existing directory.",
    hintNoConnection: "No RPC connection: reload the page or restart DSH.",
    hintTruncated: "jj output exceeded the cap: narrow the revset and try again."
  }
};

/**
 * Remote calls: channel "/api", endpoint "<service>/<method>", payload is
 * `{ args: { req } }` because the service methods declare a single parameter
 * named `req` (the gateway validates argument names against the signature).
 */
export function createRpc(ctx: unknown): Rpc | undefined {
  try {
    const connection = (ctx as { get?: (key: string) => unknown }).get?.("connection") as
      | { rpc?: { call?: (...args: unknown[]) => unknown } }
      | undefined;
    const rpc = connection?.rpc;
    if (rpc === undefined || typeof rpc.call !== "function") return undefined;
    const call = rpc.call.bind(rpc);
    return (method, payload) =>
      Promise.resolve(call("/api", `jjPanel/${method}`, { args: { req: payload } }) as RpcResponse<unknown>);
  } catch {
    return undefined;
  }
}

const LANE_WIDTH = 14;
const ACCENT = "var(--dsw-alias-state-business-primary, #4a86ff)";
const DANGER = "var(--dsw-alias-state-error-primary, #f85149)";
const WARN = "var(--dsw-alias-state-warning-primary, #d29922)";
const BORDER = "var(--dsw-alias-border-l2, rgba(255,255,255,.12))";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const S = {
  panel: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    fontSize: 13,
    color: "var(--dsw-alias-label-primary, #ddd)",
    background: "var(--dsw-alias-bg-base, transparent)"
  } as React.CSSProperties,
  toolbar: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
    padding: "6px 10px",
    borderBottom: `1px solid ${BORDER}`
  } as React.CSSProperties,
  input: {
    flex: 1,
    minWidth: 120,
    font: "inherit",
    padding: "4px 8px",
    borderRadius: 6,
    border: `1px solid ${BORDER}`,
    background: "var(--dsw-alias-bg-l2, rgba(255,255,255,.04))",
    color: "inherit"
  } as React.CSSProperties,
  button: {
    flex: "none",
    font: "inherit",
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 6,
    border: `1px solid ${BORDER}`,
    background: "var(--dsw-alias-bg-l2, rgba(255,255,255,.04))",
    color: "inherit",
    cursor: "pointer"
  } as React.CSSProperties,
  primaryButton: {
    flex: "none",
    font: "inherit",
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 6,
    border: `1px solid ${ACCENT}`,
    background: ACCENT,
    color: "#fff",
    cursor: "pointer"
  } as React.CSSProperties,
  dangerButton: {
    flex: "none",
    font: "inherit",
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 6,
    border: `1px solid ${DANGER}`,
    background: DANGER,
    color: "#fff",
    cursor: "pointer"
  } as React.CSSProperties,
  status: (kind: "ok" | "error"): React.CSSProperties => ({
    padding: "4px 10px",
    fontSize: 12,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: kind === "error" ? DANGER : "var(--dsw-alias-state-success-primary, #3fb950)",
    borderBottom: `1px solid ${BORDER}`
  }),
  errorBar: {
    padding: "6px 10px",
    color: DANGER,
    fontSize: 12,
    borderBottom: `1px solid ${BORDER}`
  } as React.CSSProperties,
  hint: { fontSize: 11, opacity: 0.75, marginTop: 2 } as React.CSSProperties,
  body: { display: "flex", flex: 1, minHeight: 0 } as React.CSSProperties,
  list: {
    width: 420,
    minWidth: 260,
    flex: "none",
    overflow: "auto",
    borderRight: `1px solid ${BORDER}`
  } as React.CSSProperties,
  placeholder: { padding: 12, opacity: 0.7 } as React.CSSProperties,
  row: (state: {
    selected: boolean;
    trunk: boolean;
    dropTarget: boolean;
    dragging: boolean;
  }): React.CSSProperties => ({
    display: "flex",
    alignItems: "stretch",
    gap: 6,
    padding: "2px 6px 2px 4px",
    minHeight: 28,
    cursor: "pointer",
    borderLeft: `2px solid ${state.trunk ? ACCENT : "transparent"}`,
    background: state.dropTarget
      ? "var(--dsw-alias-interactive-bg-hover, rgba(80,140,255,.28))"
      : state.selected
        ? "var(--dsw-alias-interactive-bg-hover, rgba(80,140,255,.16))"
        : "transparent",
    opacity: state.dragging ? 0.5 : 1,
    outline: state.dropTarget ? `1px dashed ${ACCENT}` : "none",
    outlineOffset: -1
  }),
  rowBody: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    minWidth: 0,
    flex: 1,
    gap: 1
  } as React.CSSProperties,
  subject: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as React.CSSProperties,
  rowMeta: {
    display: "flex",
    gap: 5,
    fontSize: 11,
    flexWrap: "wrap",
    alignItems: "center",
    minWidth: 0
  } as React.CSSProperties,
  changeChip: {
    fontFamily: MONO,
    fontSize: 11,
    padding: "0 4px",
    borderRadius: 4,
    background: "rgba(255,255,255,.06)"
  } as React.CSSProperties,
  rowMore: {
    flex: "none",
    alignSelf: "center",
    border: "none",
    background: "transparent",
    color: "inherit",
    opacity: 0.6,
    cursor: "pointer",
    padding: "0 4px",
    fontSize: 14,
    lineHeight: "18px"
  } as React.CSSProperties,
  chip: (kind: "default" | "accent" | "muted" | "warn" | "danger"): React.CSSProperties => {
    const color =
      kind === "accent" ? ACCENT : kind === "danger" ? DANGER : kind === "warn" ? WARN : undefined;
    return {
      fontSize: 11,
      lineHeight: "16px",
      padding: "0 6px",
      borderRadius: 999,
      border: `1px solid ${color ?? BORDER}`,
      color: color,
      opacity: kind === "muted" ? 0.65 : 0.95,
      background: kind === "accent" ? "rgba(74,134,255,.12)" : "transparent"
    };
  },
  detail: { flex: 1, minWidth: 0, overflow: "auto", padding: "8px 12px" } as React.CSSProperties,
  detailHeader: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    justifyContent: "space-between"
  } as React.CSSProperties,
  h3: { margin: "0 0 6px", fontSize: 14, minWidth: 0 } as React.CSSProperties,
  h4: { margin: "12px 0 6px", fontSize: 13 } as React.CSSProperties,
  meta: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    fontSize: 11,
    opacity: 0.85,
    marginBottom: 8,
    alignItems: "center"
  } as React.CSSProperties,
  pre: {
    margin: 0,
    padding: "8px 10px",
    overflow: "auto",
    fontFamily: MONO,
    fontSize: 12,
    lineHeight: 1.5,
    whiteSpace: "pre"
  } as React.CSSProperties,
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    justifyContent: "space-between"
  } as React.CSSProperties,
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
    padding: "2px 4px",
    borderRadius: 4,
    fontFamily: MONO,
    fontSize: 12
  } as React.CSSProperties,
  fileStatus: { display: "inline-block", width: 14, opacity: 0.8, flex: "none" } as React.CSSProperties,
  splitFooter: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 0 0",
    fontSize: 12
  } as React.CSSProperties,
  menu: {
    position: "fixed",
    zIndex: 1200,
    minWidth: 220,
    padding: 4,
    borderRadius: 8,
    border: `1px solid ${BORDER}`,
    background: "var(--dsw-alias-bg-base, #1b1e23)",
    boxShadow: "0 10px 30px rgba(0,0,0,.4)",
    display: "flex",
    flexDirection: "column"
  } as React.CSSProperties,
  menuItem: (disabled: boolean, destructive: boolean): React.CSSProperties => ({
    textAlign: "left",
    font: "inherit",
    fontSize: 12,
    padding: "5px 8px",
    border: "none",
    borderRadius: 5,
    background: "transparent",
    color: destructive ? DANGER : "inherit",
    opacity: disabled ? 0.4 : 1,
    cursor: disabled ? "default" : "pointer"
  }),
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1300,
    background: "rgba(0,0,0,.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16
  } as React.CSSProperties,
  dialog: {
    width: "min(440px, 100%)",
    borderRadius: 10,
    padding: 14,
    background: "var(--dsw-alias-bg-base, #1b1e23)",
    border: `1px solid ${BORDER}`,
    boxShadow: "0 16px 48px rgba(0,0,0,.5)",
    color: "inherit"
  } as React.CSSProperties,
  dialogTitle: { fontSize: 14, fontWeight: 600, marginBottom: 8 } as React.CSSProperties,
  dialogLine: { fontSize: 12, marginBottom: 4, wordBreak: "break-word" } as React.CSSProperties,
  dialogActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 12
  } as React.CSSProperties,
  textarea: {
    width: "100%",
    minHeight: 120,
    boxSizing: "border-box",
    font: "inherit",
    fontSize: 12,
    lineHeight: 1.5,
    padding: 8,
    borderRadius: 6,
    border: `1px solid ${BORDER}`,
    background: "var(--dsw-alias-bg-l2, rgba(255,255,255,.04))",
    color: "inherit",
    resize: "vertical"
  } as React.CSSProperties
};

interface MenuState {
  commit: Commit;
  x: number;
  y: number;
}

interface PendingConfirm {
  title: string;
  call: OpCall;
  changeId: string;
  note?: string;
}

interface DescribeEditor {
  changeId: string;
  text: string;
}

interface OpStatus {
  kind: "ok" | "error";
  text: string;
}

function LaneCell(props: { row: GraphRow<Commit>; trunkLane: number | null }): React.ReactElement {
  const { row, trunkLane } = props;
  const count = Math.max(row.lanes, row.lane + 1);
  const cells: React.ReactElement[] = [];
  for (let lane = 0; lane < count; lane += 1) {
    const trunk = trunkLane !== null && lane === trunkLane;
    cells.push(
      React.createElement("span", {
        key: `line:${String(lane)}`,
        style: {
          position: "absolute",
          left: lane * LANE_WIDTH + LANE_WIDTH / 2 - 1,
          top: 0,
          bottom: 0,
          width: 2,
          background: trunk ? ACCENT : BORDER,
          opacity: trunk ? 0.9 : 0.55
        }
      })
    );
  }
  const nodeTrunk = trunkLane !== null && row.lane === trunkLane;
  const size = nodeTrunk ? 10 : 8;
  cells.push(
    React.createElement("span", {
      key: "node",
      style: {
        position: "absolute",
        left: row.lane * LANE_WIDTH + LANE_WIDTH / 2 - size / 2,
        top: "50%",
        width: size,
        height: size,
        marginTop: -size / 2,
        borderRadius: "50%",
        background: nodeTrunk ? ACCENT : "var(--dsw-alias-label-secondary, #9aa4b2)",
        boxShadow: nodeTrunk ? "0 0 0 2px rgba(74,134,255,.25)" : "none"
      }
    })
  );
  return React.createElement(
    "span",
    {
      "aria-hidden": true,
      style: {
        position: "relative",
        width: count * LANE_WIDTH + 4,
        flex: "none",
        alignSelf: "stretch",
        minHeight: 24
      }
    },
    ...cells
  );
}

function RefChips(props: { commit: Commit; currentId: string | null }): React.ReactElement {
  const { commit, currentId } = props;
  const chips: React.ReactElement[] = [];
  if (currentId !== null && commit.changeId === currentId) {
    chips.push(React.createElement("span", { key: "at", style: S.chip("accent") }, "@"));
  }
  for (const name of commit.bookmarks) {
    chips.push(
      React.createElement(
        "span",
        { key: `b:${name}`, style: S.chip(isTrunkBookmark(name) ? "accent" : "default") },
        name
      )
    );
  }
  for (const name of commit.tags) {
    chips.push(React.createElement("span", { key: `t:${name}`, style: S.chip("muted") }, name));
  }
  if (commit.empty) {
    chips.push(React.createElement("span", { key: "empty", style: S.chip("muted") }, "empty"));
  }
  if (commit.conflict) {
    chips.push(React.createElement("span", { key: "conflict", style: S.chip("danger") }, "conflict"));
  }
  if (commit.divergent) {
    chips.push(React.createElement("span", { key: "divergent", style: S.chip("warn") }, "divergent"));
  }
  return React.createElement(
    "span",
    { style: { display: "inline-flex", gap: 4, flexWrap: "wrap" } },
    ...chips
  );
}

function DiffView(props: { patch: string }): React.ReactElement {
  const lines = props.patch.split("\n");
  return React.createElement(
    "pre",
    { style: S.pre },
    ...lines.map((line, index) => {
      const color =
        line.startsWith("+") && !line.startsWith("+++")
          ? "#3fb950"
          : line.startsWith("-") && !line.startsWith("---")
            ? "#f85149"
            : undefined;
      return React.createElement(
        "div",
        { key: index, style: color === undefined ? undefined : { color } },
        line
      );
    })
  );
}

interface Latest {
  commits: Commit[];
  selectedId: string | null;
  currentId: string | null;
  pending: PendingConfirm | null;
  describe: DescribeEditor | null;
  menu: MenuState | null;
  busy: boolean;
  t: Translate;
  select: (commit: Commit) => void;
  runOp: (call: OpCall) => Promise<boolean>;
  requestConfirm: (title: string, call: OpCall, changeId: string, note?: string) => void;
  revsetInput: React.RefObject<HTMLInputElement>;
}

export function Panel(props: { rpc?: Rpc; t: Translate; sessionId?: string }): React.ReactElement {
  const { rpc, t, sessionId } = props;
  const [revset, setRevset] = React.useState("all()");
  const [commits, setCommits] = React.useState<Commit[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [currentId, setCurrentId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<ShowData | null>(null);
  const [patch, setPatch] = React.useState("");
  const [filePath, setFilePath] = React.useState<string | null>(null);
  const [error, setError] = React.useState<{ code: string; message?: string } | null>(null);
  const [status, setStatus] = React.useState<OpStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [menu, setMenu] = React.useState<MenuState | null>(null);
  const [pending, setPending] = React.useState<PendingConfirm | null>(null);
  const [describe, setDescribe] = React.useState<DescribeEditor | null>(null);
  const [splitMode, setSplitMode] = React.useState(false);
  const [splitPaths, setSplitPaths] = React.useState<string[]>([]);
  const [dragSource, setDragSource] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);

  const revsetInput = React.useRef<HTMLInputElement | null>(null);
  const selectedIdRef = React.useRef<string | null>(null);
  const revsetRef = React.useRef("all()");
  const showToken = React.useRef(0);
  const loadToken = React.useRef(0);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const busyRef = React.useRef(false);
  const latest = React.useRef<Latest | null>(null);

  React.useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  React.useEffect(() => {
    revsetRef.current = revset;
  }, [revset]);

  const loadDetail = React.useCallback(
    async (changeId: string): Promise<void> => {
      if (rpc === undefined) return;
      showToken.current += 1;
      const token = showToken.current;
      try {
        const parsed = unwrap<ShowData>(await rpc("show", { sessionId, change: changeId }));
        if (showToken.current !== token) return;
        if (parsed.ok) {
          setDetail(parsed.value);
        } else {
          setDetail(null);
          setStatus({ kind: "error", text: formatError(parsed.error) });
        }
      } catch (cause) {
        if (showToken.current !== token) return;
        setStatus({
          kind: "error",
          text: `rpc: ${cause instanceof Error ? cause.message : String(cause)}`
        });
      }
    },
    [rpc, sessionId]
  );

  const fetchLog = React.useCallback(
    async (value: string): Promise<Commit[] | null> => {
      if (rpc === undefined) {
        setError({ code: "no-connection" });
        return null;
      }
      loadToken.current += 1;
      const token = loadToken.current;
      setLoading(true);
      setError(null);
      try {
        const [logCall, snapshotCall] = await Promise.all([
          rpc("log", { sessionId, revset: value, limit: 200 }),
          rpc("snapshot", { sessionId }).catch(() => undefined)
        ]);
        if (loadToken.current !== token) return null;
        const parsed = unwrap<{ commits: Commit[] }>(logCall);
        if (!parsed.ok) {
          setError(parsed.error);
          setCommits([]);
          return null;
        }
        const list = Array.isArray(parsed.value.commits) ? parsed.value.commits : [];
        setCommits(list);
        if (snapshotCall !== undefined) {
          const snapshot = unwrap<Snapshot>(snapshotCall);
          if (snapshot.ok) setCurrentId(snapshot.value.current?.changeId ?? null);
        }
        return list;
      } catch (cause) {
        if (loadToken.current !== token) return null;
        setError({
          code: "rpc",
          message: cause instanceof Error ? cause.message : String(cause)
        });
        setCommits([]);
        return null;
      } finally {
        if (loadToken.current === token) setLoading(false);
      }
    },
    [rpc, sessionId]
  );

  const load = React.useCallback(
    async (value: string, keepId: string | null): Promise<void> => {
      const list = await fetchLog(value);
      if (list === null) return;
      const keep =
        keepId !== null && list.some((commit) => commit.changeId === keepId) ? keepId : null;
      setSelectedId(keep);
      if (keep === null) {
        setDetail(null);
        setPatch("");
        setFilePath(null);
        setSplitMode(false);
        setSplitPaths([]);
      } else {
        await loadDetail(keep);
      }
    },
    [fetchLog, loadDetail]
  );

  React.useEffect(() => {
    void load("::@", null);
  }, [load]);

  const select = React.useCallback(
    (commit: Commit): void => {
      setSelectedId(commit.changeId);
      setDetail(null);
      setPatch("");
      setFilePath(null);
      setSplitMode(false);
      setSplitPaths([]);
      void loadDetail(commit.changeId);
    },
    [loadDetail]
  );

  const reload = React.useCallback(async (): Promise<void> => {
    await load(revsetRef.current, selectedIdRef.current);
  }, [load]);

  const runOp = async (call: OpCall): Promise<boolean> => {
    if (rpc === undefined) {
      setStatus({ kind: "error", text: "no-connection" });
      return false;
    }
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      const parsed = unwrap<{ action: string; stdout: string }>(
        await rpc("op", opPayload(sessionId, call))
      );
      if (!parsed.ok) {
        setStatus({ kind: "error", text: formatError(parsed.error) });
        // A host-level failure may still have moved the repo (e.g. a partial
        // fetch); resync while keeping the selection by change id.
        await reload();
        return false;
      }
      setStatus({ kind: "ok", text: formatOpResult(parsed.value) });
      setSplitMode(false);
      setSplitPaths([]);
      await reload();
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // A 404 here is the gateway saying the host half has no `op` yet: the
      // browser half hot-reloaded but the host plugin still runs old code.
      const needsRestart = /HTTP 404/u.test(message);
      setStatus({
        kind: "error",
        text: needsRestart ? t("restartRequired") : `rpc: ${message}`
      });
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const requestConfirm = (
    title: string,
    call: OpCall,
    changeId: string,
    note?: string
  ): void => {
    if (!opNeedsConfirm(call.action)) {
      void runOp(call);
      return;
    }
    setPending({ title, call, changeId, ...(note === undefined ? {} : { note }) });
  };

  const openFile = async (path: string): Promise<void> => {
    if (rpc === undefined || selectedId === null) return;
    setFilePath(path);
    const parsed = unwrap<{ patch: string }>(
      await rpc("diff", { sessionId, change: selectedId, path })
    );
    if (parsed.ok) setPatch(parsed.value.patch);
    else setStatus({ kind: "error", text: formatError(parsed.error) });
  };

  const openDescribe = async (commit: Commit): Promise<void> => {
    setSelectedId(commit.changeId);
    let message: string | null =
      detail !== null && detail.commit.changeId === commit.changeId ? detail.message : null;
    if (message === null) {
      if (rpc === undefined) {
        message = "";
      } else {
        setDetail(null);
        setPatch("");
        setFilePath(null);
        setSplitMode(false);
        setSplitPaths([]);
        const parsed = unwrap<ShowData>(
          await rpc("show", { sessionId, change: commit.changeId })
        );
        if (!parsed.ok) {
          setStatus({ kind: "error", text: formatError(parsed.error) });
          return;
        }
        message = parsed.value.message;
        setDetail(parsed.value);
      }
    }
    setDescribe({ changeId: commit.changeId, text: message ?? "" });
  };

  const saveDescribe = async (): Promise<void> => {
    if (describe === null) return;
    const ok = await runOp({
      action: "describe",
      params: { change: describe.changeId, message: describe.text }
    });
    if (ok) setDescribe(null);
  };

  const openSplit = async (commit: Commit): Promise<void> => {
    if (commit.empty) {
      setStatus({ kind: "ok", text: t("noFiles") });
      return;
    }
    if (detail === null || detail.commit.changeId !== commit.changeId) {
      setSelectedId(commit.changeId);
      setPatch("");
      setFilePath(null);
      await loadDetail(commit.changeId);
    }
    setSplitMode(true);
    setSplitPaths([]);
  };

  const toggleSplitPath = (path: string): void => {
    setSplitPaths((previous) =>
      previous.includes(path) ? previous.filter((entry) => entry !== path) : [...previous, path]
    );
  };

  const runSplit = async (): Promise<void> => {
    if (detail === null || splitPaths.length === 0) return;
    if (currentId === null || detail.commit.changeId !== currentId) {
      setStatus({ kind: "error", text: t("splitOnlyCurrent") });
      return;
    }
    const ok = await runOp({
      action: "split",
      params: { change: detail.commit.changeId, paths: splitPaths }
    });
    if (ok) {
      setSplitMode(false);
      setSplitPaths([]);
    }
  };

  const copyChangeId = (changeId: string): void => {
    try {
      const clipboard = (navigator as unknown as { clipboard?: Clipboard }).clipboard;
      if (clipboard === undefined) {
        setStatus({ kind: "ok", text: `${t("copied")}: ${changeId}` });
        return;
      }
      void clipboard.writeText(changeId).then(
        () => setStatus({ kind: "ok", text: `${t("copied")}: ${changeId}` }),
        () => setStatus({ kind: "error", text: t("copyFailed") })
      );
    } catch {
      setStatus({ kind: "error", text: t("copyFailed") });
    }
  };

  const openMenu = (commit: Commit, x: number, y: number): void => {
    select(commit);
    const width = 240;
    const height = 380;
    const left =
      typeof window === "undefined" ? x : Math.max(8, Math.min(x, window.innerWidth - width - 8));
    const top =
      typeof window === "undefined" ? y : Math.max(8, Math.min(y, window.innerHeight - height - 8));
    setMenu({ commit, x: left, y: top });
  };

  const handleMenuAction = (id: MenuActionId, commit: Commit): void => {
    setMenu(null);
    switch (id) {
      case "new":
        void runOp({ action: "new", params: { onto: commit.changeId } });
        break;
      case "edit":
        void runOp({ action: "edit", params: { change: commit.changeId } });
        break;
      case "describe":
        void openDescribe(commit);
        break;
      case "squash":
        void runOp({ action: "squash", params: { from: commit.changeId } });
        break;
      case "abandon":
        requestConfirm(
          t("menuAbandon"),
          { action: "abandon", params: { change: commit.changeId } },
          commit.changeId
        );
        break;
      case "abandon-subtree":
        requestConfirm(
          t("menuAbandonSubtree"),
          { action: "abandon", params: { change: commit.changeId, subtree: true } },
          commit.changeId
        );
        break;
      case "duplicate":
        void runOp({ action: "duplicate", params: { change: commit.changeId } });
        break;
      case "revert":
        requestConfirm(
          t("menuRevert"),
          { action: "revert", params: { change: commit.changeId, destination: "@" } },
          commit.changeId
        );
        break;
      case "split":
        void openSplit(commit);
        break;
      case "copy":
        copyChangeId(commit.changeId);
        break;
      case "push": {
        const bookmark = commit.bookmarks[0];
        if (bookmark === undefined) break;
        requestConfirm(
          t("menuPush"),
          { action: "push", params: { name: bookmark } },
          commit.changeId,
          bookmark
        );
        break;
      }
      default:
        break;
    }
  };

  const confirmPending = (): void => {
    if (pending === null) return;
    const { call } = pending;
    setPending(null);
    void runOp({ ...call, confirm: true });
  };

  React.useEffect(() => {
    latest.current = {
      commits,
      selectedId,
      currentId,
      pending,
      describe,
      menu,
      busy,
      t,
      select,
      runOp,
      requestConfirm,
      revsetInput
    };
  });

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const state = latest.current;
      if (state === null) return;
      // Only act while the panel itself has focus, and never on modified keys:
      // otherwise Enter anywhere on the page would run `jj edit`.
      const panel = panelRef.current;
      if (panel === null || !panel.contains(document.activeElement)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing) return;
      if (event.key === "Escape") {
        setMenu(null);
        setPending(null);
        setDescribe(null);
        return;
      }
      if (state.pending !== null || state.describe !== null) return;
      if (state.menu !== null) setMenu(null);
      if (
        event.key === "Enter" &&
        target !== null &&
        (target.tagName === "BUTTON" || target.tagName === "A")
      ) {
        return;
      }
      switch (event.key) {
        case "j":
        case "ArrowDown": {
          event.preventDefault();
          const id = nextSelection(state.commits, state.selectedId, 1);
          const commit = id === null ? undefined : findCommit(state.commits, id);
          if (commit !== undefined) state.select(commit);
          break;
        }
        case "k":
        case "ArrowUp": {
          event.preventDefault();
          const id = nextSelection(state.commits, state.selectedId, -1);
          const commit = id === null ? undefined : findCommit(state.commits, id);
          if (commit !== undefined) state.select(commit);
          break;
        }
        case "Enter": {
          const commit =
            state.selectedId === null ? undefined : findCommit(state.commits, state.selectedId);
          if (commit !== undefined) {
            event.preventDefault();
            void state.runOp({ action: "edit", params: { change: commit.changeId } });
          }
          break;
        }
        case "n": {
          const commit =
            state.selectedId === null ? undefined : findCommit(state.commits, state.selectedId);
          if (commit !== undefined) {
            event.preventDefault();
            void state.runOp({ action: "new", params: { onto: commit.changeId } });
          }
          break;
        }
        case "u": {
          event.preventDefault();
          state.requestConfirm(state.t("undo"), { action: "undo" }, state.currentId ?? "@");
          break;
        }
        case "/": {
          event.preventDefault();
          state.revsetInput.current?.focus();
          state.revsetInput.current?.select();
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  React.useEffect(() => {
    if (menu === null) return;
    const close = (): void => setMenu(null);
    document.addEventListener("mousedown", close);
    return () => {
      document.removeEventListener("mousedown", close);
    };
  }, [menu]);

  const selected = selectedId === null ? null : findCommit(commits, selectedId) ?? null;
  const rows = layoutGraph(commits);
  const trunkId = trunkChangeId(commits);
  const trunkLane =
    trunkId === null ? null : rows.find((row) => row.commit.changeId === trunkId)?.lane ?? null;
  const menuCommit = menu === null ? null : menu.commit;
  const menuEntries =
    menuCommit === null ? [] : menuItems({ commit: menuCommit, currentChangeId: currentId, busy });
  const hintKey = error === null ? null : errorHintKey(error.code);

  const tree =
    commits.length === 0
      ? React.createElement(
          "div",
          { style: S.placeholder },
          loading ? t("loading") : t("empty")
        )
      : rows.map((row) => {
          const commit = row.commit;
          const selectedRow = selectedId === commit.changeId;
          return React.createElement(
            "div",
            {
              key: `${commit.changeId}:${commit.commitId}`,
              role: "treeitem",
              "aria-selected": selectedRow,
              draggable: true,
              title: commit.subject === "" ? t("noDescription") : commit.subject,
              style: S.row({
                selected: selectedRow,
                trunk: commit.changeId === trunkId,
                dropTarget: dropTarget === commit.changeId,
                dragging: dragSource === commit.changeId
              }),
              onClick: () => {
                select(commit);
              },
              onDoubleClick: () => {
                void runOp({ action: "edit", params: { change: commit.changeId } });
              },
              onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => {
                event.preventDefault();
                openMenu(commit, event.clientX, event.clientY);
              },
              onDragStart: (event: React.DragEvent<HTMLDivElement>) => {
                event.dataTransfer.setData("text/plain", commit.changeId);
                event.dataTransfer.effectAllowed = "move";
                setDragSource(commit.changeId);
              },
              onDragEnd: () => {
                setDragSource(null);
                setDropTarget(null);
              },
              onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
                const source = dragSource;
                if (source === null) return;
                const plan = planRebaseDrop(commits, source, commit.changeId, {
                  alt: event.altKey
                });
                if (!plan.ok) {
                  setDropTarget((previous) =>
                    previous === commit.changeId ? null : previous
                  );
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget(commit.changeId);
              },
              onDragLeave: () => {
                setDropTarget((previous) =>
                  previous === commit.changeId ? null : previous
                );
              },
              onDrop: (event: React.DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                const source = dragSource ?? event.dataTransfer.getData("text/plain");
                setDragSource(null);
                setDropTarget(null);
                if (source === "") return;
                const plan = planRebaseDrop(commits, source, commit.changeId, {
                  alt: event.altKey
                });
                if (!plan.ok) {
                  setStatus({ kind: "error", text: `${t("dropRejected")}: ${plan.reason}` });
                  return;
                }
                void runOp({
                  action: "rebase",
                  params: {
                    change: source,
                    destination: plan.destination,
                    ...(plan.mode === "before" ? { mode: "before" as const } : {})
                  }
                });
              }
            },
            React.createElement(LaneCell, { row, trunkLane }),
            React.createElement(
              "span",
              { style: S.rowBody },
              React.createElement(
                "span",
                { style: S.subject },
                commit.subject === "" ? t("noDescription") : commit.subject
              ),
              React.createElement(
                "span",
                { style: S.rowMeta },
                React.createElement("code", { style: S.changeChip }, commit.changeId),
                React.createElement(RefChips, { commit, currentId })
              )
            ),
            React.createElement(
              "button",
              {
                type: "button",
                title: t("actions"),
                style: S.rowMore,
                onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  openMenu(commit, rect.left, rect.bottom + 4);
                }
              },
              "⋯"
            )
          );
        });

  const detailView =
    detail === null
      ? React.createElement("div", { style: S.placeholder }, t("select"))
      : React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { style: S.detailHeader },
            React.createElement(
              "h3",
              { style: S.h3 },
              detail.commit.subject || t("noDescription")
            ),
            React.createElement(
              "button",
              {
                type: "button",
                style: S.button,
                onClick: () => {
                  void openDescribe(detail.commit);
                }
              },
              t("editDescription")
            )
          ),
          React.createElement(
            "div",
            { style: S.meta },
            React.createElement(
              "span",
              null,
              `${t("changeId")}: `,
              React.createElement("code", null, detail.commit.changeId)
            ),
            React.createElement(
              "span",
              null,
              `${t("commitId")}: `,
              React.createElement("code", null, detail.commit.commitId)
            ),
            React.createElement("span", null, `${t("author")}: ${detail.author.name}`),
            React.createElement("span", null, detail.author.timestamp),
            React.createElement(RefChips, { commit: detail.commit, currentId })
          ),
          detail.message !== ""
            ? React.createElement(
                "pre",
                { style: { ...S.pre, padding: 0, opacity: 0.85 } },
                detail.message
              )
            : null,
          React.createElement(
            "div",
            { style: S.sectionHeader },
            React.createElement("h4", { style: S.h4 }, t("files")),
            detail.files.length > 0
              ? React.createElement(
                  "button",
                  {
                    type: "button",
                    style: S.button,
                    disabled: busy || detail.commit.empty,
                    onClick: () => {
                      setSplitMode((previous) => !previous);
                      setSplitPaths([]);
                    }
                  },
                  splitMode ? t("close") : t("splitByFile")
                )
              : null
          ),
          detail.files.length === 0
            ? React.createElement("div", { style: S.hint }, t("noFiles"))
            : React.createElement(
                "div",
                null,
                ...detail.files.map((file) =>
                  React.createElement(
                    "div",
                    {
                      key: file.path,
                      style: {
                        ...S.fileRow,
                        background:
                          filePath === file.path
                            ? "var(--dsw-alias-interactive-bg-hover, rgba(80,140,255,.16))"
                            : "transparent"
                      },
                      onClick: () => {
                        if (splitMode) toggleSplitPath(file.path);
                        else void openFile(file.path);
                      }
                    },
                    splitMode
                      ? React.createElement("input", {
                          type: "checkbox",
                          checked: splitPaths.includes(file.path),
                          readOnly: true,
                          tabIndex: -1,
                          "aria-label": file.path,
                          style: { margin: 0 }
                        })
                      : null,
                    React.createElement(
                      "span",
                      { style: S.fileStatus },
                      file.status
                    ),
                    file.path
                  )
                )
              ),
          splitMode
            ? React.createElement(
                "div",
                { style: S.splitFooter },
                React.createElement(
                  "span",
                  null,
                  `${t("selectedFiles")}: ${String(splitPaths.length)}`
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    style: splitPaths.length === 0 ? S.button : S.primaryButton,
                    disabled: busy || splitPaths.length === 0,
                    onClick: () => {
                      void runSplit();
                    }
                  },
                  t("splitIntoNew")
                )
              )
            : null,
          filePath !== null
            ? React.createElement(
                "div",
                { style: { marginTop: 12 } },
                React.createElement(
                  "h4",
                  { style: { margin: "0 0 6px", fontSize: 13 } },
                  `${t("diff")}: ${filePath}`
                ),
                React.createElement(DiffView, { patch })
              )
            : null
        );

  return React.createElement(
    "div",
    {
      className: "jjp-panel",
      style: { ...S.panel, outline: "none" },
      tabIndex: 0,
      ref: panelRef,
      onMouseDown: () => {
        panelRef.current?.focus();
      }
    },
    React.createElement(
      "div",
      { style: S.toolbar },
      React.createElement("input", {
        ref: revsetInput,
        style: S.input,
        value: revset,
        spellCheck: false,
        placeholder: t("revset"),
        "aria-label": t("revset"),
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          setRevset(event.target.value);
        },
        onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") void load(revset, selectedIdRef.current);
          if (event.key === "Escape") event.currentTarget.blur();
        }
      }),
      React.createElement(
        "button",
        {
          type: "button",
          style: S.button,
          disabled: busy,
          onClick: () => {
            void load(revset, selectedIdRef.current);
          }
        },
        t("refresh")
      ),
      React.createElement(
        "button",
        {
          type: "button",
          style: S.button,
          disabled: busy,
          onClick: () => {
            requestConfirm(t("undo"), { action: "undo" }, currentId ?? "@");
          }
        },
        t("undo")
      ),
      React.createElement(
        "button",
        {
          type: "button",
          style: S.button,
          disabled: busy,
          onClick: () => {
            void runOp({ action: "fetch" });
          }
        },
        t("fetch")
      )
    ),
    status !== null
      ? React.createElement("div", { role: "status", style: S.status(status.kind) }, status.text)
      : null,
    error !== null
      ? React.createElement(
          "div",
          { role: "alert", style: S.errorBar },
          `${t("error")}: ${formatError(error)}`,
          hintKey === null
            ? null
            : React.createElement("div", { style: S.hint }, t(hintKey))
        )
      : null,
    React.createElement(
      "div",
      { style: S.body },
      React.createElement("div", { style: S.list }, ...(Array.isArray(tree) ? tree : [tree])),
      React.createElement("div", { style: S.detail }, detailView)
    ),
    menu !== null && menuCommit !== null
      ? React.createElement(
          "div",
          {
            role: "menu",
            style: { ...S.menu, left: menu.x, top: menu.y },
            onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => {
              event.stopPropagation();
            }
          },
          ...menuEntries
            .filter((entry) => entry.visible)
            .map((entry) =>
              React.createElement(
                "button",
                {
                  key: entry.id,
                  type: "button",
                  role: "menuitem",
                  disabled: !entry.enabled,
                  style: S.menuItem(!entry.enabled, entry.destructive),
                  onClick: () => {
                    handleMenuAction(entry.id, menuCommit);
                  }
                },
                t(entry.labelKey)
              )
            )
        )
      : null,
    pending !== null
      ? React.createElement(
          "div",
          {
            style: S.overlay,
            onClick: (event: React.MouseEvent<HTMLDivElement>) => {
              if (event.target === event.currentTarget) setPending(null);
            }
          },
          React.createElement(
            "div",
            { role: "dialog", "aria-modal": true, "aria-label": pending.title, style: S.dialog },
            React.createElement("div", { style: S.dialogTitle }, pending.title),
            React.createElement(
              "div",
              { style: S.dialogLine },
              `${t("action")}: `,
              React.createElement("code", null, pending.call.action)
            ),
            React.createElement(
              "div",
              { style: S.dialogLine },
              `${t("target")}: `,
              React.createElement("code", null, pending.changeId)
            ),
            pending.note === undefined
              ? null
              : React.createElement(
                  "div",
                  { style: S.dialogLine },
                  `${t("bookmark")}: `,
                  React.createElement("code", null, pending.note)
                ),
            React.createElement(
              "div",
              { style: S.dialogActions },
              React.createElement(
                "button",
                {
                  type: "button",
                  style: S.button,
                  onClick: () => {
                    setPending(null);
                  }
                },
                t("cancel")
              ),
              React.createElement(
                "button",
                {
                  type: "button",
                  style: S.dangerButton,
                  disabled: busy,
                  onClick: confirmPending
                },
                t("confirm")
              )
            )
          )
        )
      : null,
    describe !== null
      ? React.createElement(
          "div",
          {
            style: S.overlay,
            onClick: (event: React.MouseEvent<HTMLDivElement>) => {
              if (event.target === event.currentTarget) setDescribe(null);
            }
          },
          React.createElement(
            "div",
            {
              role: "dialog",
              "aria-modal": true,
              "aria-label": t("describeTitle"),
              style: { ...S.dialog, width: "min(560px, 100%)" }
            },
            React.createElement(
              "div",
              { style: S.dialogTitle },
              `${t("describeTitle")}: `,
              React.createElement("code", null, describe.changeId)
            ),
            React.createElement("textarea", {
              style: S.textarea,
              value: describe.text,
              spellCheck: false,
              "aria-label": t("describeTitle"),
              onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
                const value = event.target.value;
                setDescribe((previous) =>
                  previous === null ? null : { ...previous, text: value }
                );
              },
              onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void saveDescribe();
                }
              }
            }),
            React.createElement(
              "div",
              { style: S.dialogActions },
              React.createElement(
                "button",
                {
                  type: "button",
                  style: S.button,
                  onClick: () => {
                    setDescribe(null);
                  }
                },
                t("cancel")
              ),
              React.createElement(
                "button",
                {
                  type: "button",
                  style: S.primaryButton,
                  disabled: busy,
                  onClick: () => {
                    void saveDescribe();
                  }
                },
                t("save")
              )
            )
          )
        )
      : null
  );
}

export function apply(ctx: unknown): void {
  const context = ctx as {
    locale: {
      register(name: string, dictionaries: unknown): unknown;
      bind(name: string): Translate;
    };
    slots: {
      inject(name: string, register: () => unknown): unknown;
      register(
        options: Record<string, unknown>,
        component: (props: { sessionId?: string }) => React.ReactElement
      ): unknown;
    };
    effect(fn: () => unknown, label?: string): unknown;
    get(key: string): unknown;
  };
  const rpc = createRpc(context);
  context.effect(() => context.locale.register(NS, STRINGS), `${NS}: dictionaries`);
  const t = context.locale.bind(NS);
  context.slots.inject("conversation.view", () =>
    context.slots.register(
      { name: "conversation.view", id: NS, order: 31, locale: NS, label: () => t("tab") },
      (props) =>
        React.createElement(Panel, {
          rpc,
          t,
          ...(props.sessionId === undefined ? {} : { sessionId: props.sessionId })
        })
    )
  );
}

export { inject, name } from "./meta";
