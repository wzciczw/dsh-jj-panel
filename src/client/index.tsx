import * as React from "react";
import { layoutGraph, type GraphCommit } from "./graph";

const NS = "jj-panel";

type Translate = (key: string, vars?: Record<string, unknown>) => string;

interface Commit extends GraphCommit {
  bookmarks: string[];
  tags: string[];
  empty: boolean;
  conflict: boolean;
  divergent: boolean;
  subject: string;
}

interface ShowData {
  commit: Commit;
  message: string;
  author: { name: string; email: string; timestamp: string };
  files: { status: string; path: string }[];
}

interface RpcResponse<T> {
  ok: boolean;
  value?: T;
  error?: { code?: string; message?: string };
}

type Rpc = (method: string, payload: Record<string, unknown>) => Promise<RpcResponse<unknown>>;

const STRINGS = {
  zh: {
    tab: "Jujutsu",
    refresh: "刷新",
    revset: "revset",
    empty: "当前工作区没有可显示的 change",
    notRepo: "当前工作区不是 Jujutsu 仓库",
    noJj: "找不到 jj 可执行文件，请在插件设置里配置 jjPath",
    loading: "加载中…",
    select: "选择一个 change 查看详情",
    files: "改动文件",
    noFiles: "该 change 没有改动文件",
    message: "描述",
    changeId: "change",
    commitId: "commit",
    author: "作者",
    error: "加载失败",
    retry: "重试",
    truncated: "输出被截断",
    diff: "差异"
  },
  en: {
    tab: "Jujutsu",
    refresh: "Refresh",
    revset: "revset",
    empty: "No changes to show in this workspace",
    notRepo: "This workspace is not a Jujutsu repository",
    noJj: "jj executable not found; configure jjPath in the plugin settings",
    loading: "Loading…",
    select: "Select a change to see details",
    files: "Changed files",
    noFiles: "This change has no changed files",
    message: "Description",
    changeId: "change",
    commitId: "commit",
    author: "Author",
    error: "Failed to load",
    retry: "Retry",
    truncated: "Output truncated",
    diff: "Diff"
  }
};

function createRpc(ctx: unknown): Rpc | undefined {
  try {
    const connection = (ctx as { get?: (key: string) => unknown }).get?.("connection") as
      | { rpc?: { call?: (...args: unknown[]) => unknown } }
      | undefined;
    const rpc = connection?.rpc;
    if (rpc === undefined || typeof rpc.call !== "function") return undefined;
    return (method, payload) =>
      Promise.resolve(rpc.call!(rpc, "/api", "jjPanel", method, payload) as RpcResponse<unknown>);
  } catch {
    return undefined;
  }
}

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
    padding: "6px 10px",
    borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.08))"
  } as React.CSSProperties,
  input: {
    flex: 1,
    minWidth: 0,
    font: "inherit",
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12))",
    background: "var(--dsw-alias-bg-l2, rgba(255,255,255,.04))",
    color: "inherit"
  } as React.CSSProperties,
  body: { display: "flex", flex: 1, minHeight: 0 } as React.CSSProperties,
  list: {
    width: 380,
    minWidth: 240,
    overflow: "auto",
    borderRight: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.08))"
  } as React.CSSProperties,
  row: (selected: boolean): React.CSSProperties => ({
    display: "flex",
    gap: 6,
    padding: "4px 8px",
    cursor: "pointer",
    alignItems: "baseline",
    background: selected ? "var(--dsw-alias-interactive-bg-hover, rgba(80,140,255,.16))" : "transparent"
  }),
  lane: (lane: number) => ({
    marginLeft: lane * 14,
    width: 8,
    height: 8,
    flex: "none",
    borderRadius: 999,
    background: "var(--dsw-alias-state-business-primary, #4a86ff)",
    alignSelf: "center"
  }) as React.CSSProperties,
  detail: { flex: 1, minWidth: 0, overflow: "auto", padding: "8px 12px" } as React.CSSProperties,
  chip: {
    fontSize: 11,
    padding: "0 6px",
    borderRadius: 999,
    border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16))",
    opacity: 0.85
  } as React.CSSProperties,
  pre: {
    margin: 0,
    padding: "8px 10px",
    overflow: "auto",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 12,
    lineHeight: 1.5,
    whiteSpace: "pre"
  } as React.CSSProperties
};

function RefChips({ commit }: { commit: Commit }): React.ReactElement | null {
  if (commit.bookmarks.length === 0 && commit.tags.length === 0 && !commit.empty) return null;
  return React.createElement(
    "span",
    { style: { display: "inline-flex", gap: 4, flexWrap: "wrap" } },
    ...commit.bookmarks.map((name) => React.createElement("span", { key: `b:${name}`, style: S.chip }, name)),
    ...commit.tags.map((name) => React.createElement("span", { key: `t:${name}`, style: { ...S.chip, opacity: 0.7 } }, name)),
    commit.empty ? React.createElement("span", { key: "e", style: S.chip }, "empty") : null
  );
}

function DiffView({ patch }: { patch: string }): React.ReactElement {
  const lines = patch.split("\n");
  return React.createElement(
    "pre",
    { style: S.pre },
    ...lines.map((line, index) => {
      const color = line.startsWith("+") && !line.startsWith("+++")
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

export function Panel(props: { rpc?: Rpc; t: Translate; sessionId?: string }): React.ReactElement {
  const { rpc, t, sessionId } = props;
  const [revset, setRevset] = React.useState("::@");
  const [commits, setCommits] = React.useState<Commit[]>([]);
  const [selected, setSelected] = React.useState<Commit | null>(null);
  const [detail, setDetail] = React.useState<ShowData | null>(null);
  const [patch, setPatch] = React.useState("");
  const [filePath, setFilePath] = React.useState<string | null>(null);
  const [error, setError] = React.useState<{ code: string; message?: string } | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(
    async (value: string) => {
      if (rpc === undefined) {
        setError({ code: "no-connection" });
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const response = await rpc("log", { sessionId, revset: value, limit: 200 });
        if (!response.ok) {
          setError({ code: response.error?.code ?? "error", ...(response.error?.message === undefined ? {} : { message: response.error.message }) });
          setCommits([]);
          return;
        }
        const value2 = response.value as { commits: Commit[] };
        setCommits(value2.commits);
      } catch (cause) {
        setError({ code: "rpc", message: cause instanceof Error ? cause.message : String(cause) });
      } finally {
        setLoading(false);
      }
    },
    [rpc, sessionId]
  );

  React.useEffect(() => {
    void load("::@");
  }, [load]);

  const select = async (commit: Commit): Promise<void> => {
    setSelected(commit);
    setDetail(null);
    setPatch("");
    setFilePath(null);
    if (rpc === undefined) return;
    const response = await rpc("show", { sessionId, change: commit.changeId });
    if (response.ok) setDetail(response.value as ShowData);
  };

  const openFile = async (path: string): Promise<void> => {
    if (rpc === undefined || selected === null) return;
    setFilePath(path);
    const response = await rpc("diff", { sessionId, change: selected.changeId, path });
    if (response.ok) setPatch((response.value as { patch: string }).patch);
  };

  const rows = layoutGraph(commits);

  const list = commits.length === 0
    ? React.createElement("div", { style: { padding: 12, opacity: 0.7 } }, loading ? t("loading") : t("empty"))
    : rows.map((row) =>
        React.createElement(
          "div",
          {
            key: row.commit.changeId,
            style: S.row(selected?.changeId === row.commit.changeId),
            onClick: () => {
              void select(row.commit);
            }
          },
          React.createElement("span", { style: S.lane(row.lane) }),
          React.createElement(
            "span",
            { style: { display: "flex", flexDirection: "column", minWidth: 0 } },
            React.createElement(
              "span",
              { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
              row.commit.subject === "" ? "(no description)" : row.commit.subject
            ),
            React.createElement(
              "span",
              { style: { display: "flex", gap: 6, fontSize: 11, opacity: 0.7, flexWrap: "wrap" } },
              React.createElement("span", { style: { fontFamily: "ui-monospace, monospace" } }, row.commit.changeId),
              React.createElement(RefChips, { commit: row.commit })
            )
          )
        )
      );

  const detailView = detail === null
    ? React.createElement("div", { style: { opacity: 0.7 } }, t("select"))
    : React.createElement(
        "div",
        null,
        React.createElement("h3", { style: { margin: "0 0 6px", fontSize: 14 } }, detail.commit.subject || "(no description)"),
        React.createElement(
          "div",
          { style: { display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11, opacity: 0.75, marginBottom: 8 } },
          React.createElement("span", null, `${t("changeId")}: `, React.createElement("code", null, detail.commit.changeId)),
          React.createElement("span", null, `${t("commitId")}: `, React.createElement("code", null, detail.commit.commitId)),
          React.createElement("span", null, `${t("author")}: ${detail.author.name}`),
          React.createElement("span", null, detail.author.timestamp)
        ),
        detail.message !== "" && detail.message !== detail.commit.subject
          ? React.createElement("pre", { style: { ...S.pre, padding: 0, opacity: 0.85 } }, detail.message)
          : null,
        React.createElement("h4", { style: { margin: "12px 0 6px", fontSize: 13 } }, t("files")),
        detail.files.length === 0
          ? React.createElement("div", { style: { opacity: 0.7 } }, t("noFiles"))
          : React.createElement(
              "div",
              null,
              ...detail.files.map((file) =>
                React.createElement(
                  "div",
                  {
                    key: file.path,
                    style: {
                      cursor: "pointer",
                      padding: "2px 4px",
                      borderRadius: 4,
                      background: filePath === file.path ? "var(--dsw-alias-interactive-bg-hover, rgba(80,140,255,.16))" : "transparent",
                      fontFamily: "ui-monospace, monospace",
                      fontSize: 12
                    },
                    onClick: () => {
                      void openFile(file.path);
                    }
                  },
                  React.createElement("span", { style: { display: "inline-block", width: 18, opacity: 0.8 } }, file.status),
                  file.path
                )
              )
            ),
        filePath !== null
          ? React.createElement(
              "div",
              { style: { marginTop: 12 } },
              React.createElement("h4", { style: { margin: "0 0 6px", fontSize: 13 } }, `${t("diff")}: ${filePath}`),
              React.createElement(DiffView, { patch })
            )
          : null
      );

  return React.createElement(
    "div",
    { className: "jjp-panel", style: S.panel },
    React.createElement(
      "div",
      { style: S.toolbar },
      React.createElement("input", {
        style: S.input,
        value: revset,
        spellCheck: false,
        placeholder: t("revset"),
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setRevset(event.target.value),
        onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") void load(revset);
        }
      }),
      React.createElement(
        "button",
        {
          type: "button",
          style: { ...S.input, flex: "none", cursor: "pointer" },
          onClick: () => {
            void load(revset);
          }
        },
        t("refresh")
      )
    ),
    error !== null
      ? React.createElement(
          "div",
          { style: { padding: "6px 10px", color: "var(--dsw-alias-state-error-primary, #f85149)" } },
          `${t("error")}: ${error.code}${error.message === undefined ? "" : ` — ${error.message}`}`
        )
      : null,
    React.createElement(
      "div",
      { style: S.body },
      React.createElement("div", { style: S.list }, ...(Array.isArray(list) ? list : [list])),
      React.createElement("div", { style: S.detail }, detailView)
    )
  );
}

export function apply(ctx: unknown): void {
  const context = ctx as {
    locale: { register(name: string, dictionaries: unknown): unknown; bind(name: string): Translate };
    slots: {
      inject(name: string, register: () => unknown): unknown;
      register(options: Record<string, unknown>, component: (props: { sessionId?: string }) => React.ReactElement): unknown;
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
      (props) => React.createElement(Panel, { rpc, t, ...(props.sessionId === undefined ? {} : { sessionId: props.sessionId }) })
    )
  );
}

export { inject, name } from "./meta";
