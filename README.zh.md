# dsh-jj-panel

[English](README.md) | 简体中文

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI 用的 [Jujutsu](https://jj-vcs.dev) 历史面板。直接读 `jj`（不经过 git 转译），在独立的 **Jujutsu** 标签页里展示 change 图、change 详情、改动文件与差异，并通过 jj 原生的方式改写历史。

## 功能

- **change 树**：`jj log` 渲染为分道图，含 change ID、commit ID、bookmark、tag、`empty`/`conflict`/`divergent` 标记、`@` 工作副本标记，并突出 `main`（缺失时回退 `master`）主干道；
- **change 详情**：完整描述、作者与时间、改动文件及状态（`M`/`A`/`D`/`R`）；
- **差异**：点击文件加载 `jj diff --git`，按 `+`/`-` 着色；
- **revset 输入框**：默认 `all()`（可切到 `::@` 只看当前栈），可输入 `all()`、`bookmarks()`、`description("…")`；
- **结构化编辑**：右键或 `⋯` 按钮可在此新建、编辑、修改描述、压缩进父 change、放弃（或整棵子树）、复制、回滚到 `@`、按文件拆分、复制 change id、推送 bookmark；
- **拖拽 rebase**：把一行拖到另一行即 rebase；按住 Alt 拖放则 插入到目标之前（栈内重排）。拖到自身或自身的后代会被忽略；
- **按文件拆分**：在详情里切换拆分模式，勾选文件后点击「拆分到新 change」；
- **撤销 / 拉取**：工具栏操作；破坏性操作（放弃、放弃子树、回滚、撤销、推送）会先弹出内联确认框，显示操作名与目标 change，确认后才执行；
- **键盘**：`j`/`k` 移动选择，`Enter` 编辑，`n` 在选择处新建，`u` 确认撤销，`/` 聚焦 revset 输入框。

## 环境要求

- DSH `0.2.1-rc.2` 及以上（0.2.x 线，web profile）；
- `jj` 0.44+ 在 `PATH` 中，或在配置里指定 `jjPath`；
- 工作区必须是 jj 仓库（已有 git 仓库可 `jj git init --colocate`）。

## 安装

```bash
dsh plugin --profile web add dsh-jj-panel
```

或从本地检出安装：

```bash
dsh plugin --profile web add file:D:\path\to\dsh-jj-panel
```

安装后打开会话视图里的 **Jujutsu** 标签页。host 半改动需要重启 DSH，浏览器半会热更新。

### 插件市场源

仓库自带 format-1 市场索引 [`market/index.json`](market/index.json)。在 **Plugins → Discover** 里把下面的地址加为 market source，即可安装索引中钉住的版本：

```
https://raw.githubusercontent.com/wzciczw/dsh-jj-panel/master/market/index.json
```

索引在测试中用 `@deepseek-ai/dsh-plugin-market-index` 校验。

## 配置

```yaml
- id: jj-panel
  name: "dsh-jj-panel"
  config:
    jjPath: 'C:\path\to\jj.exe'   # 默认依次为 PATH、winget 安装位置
    timeoutMs: 8000
    maxBytes: 4194304
    defaultLimit: 120             # 每次加载的提交数（1..500）
```

## 实现

- host 半：Cordis 插件，注册 `TypertRemoteService`（命名空间 `jjPanel`），暴露 `snapshot` / `log` / `show` / `diff` / `op` 五个 Remote 方法；所有命令以 argv 数组 spawn，不经过 shell。
- browser 半：React 面板注册到 `conversation.view`，通过 `connection.rpc.call(rpc, "/api", "jjPanel", …)` 调 host。
- 数据来自 `jj log --no-graph -T …` 模板（change id、commit id、parents、bookmarks、tags、标记、描述首行）；详情用 `jj show --no-patch -T 'json(self)'`。
- 所有结构化编辑都走 `jjPanel/op`（action + params），由 host 构造 argv 并返回 stdout，面板在状态行里展示。

## 安全边界

- 写操作只限于 `op` 的 action 白名单，browser 半不自行拼接 jj 命令；
- 放弃、放弃子树、回滚、撤销、推送需要 `confirm: true`：面板先弹确认框，host 也会拒绝未确认的调用；
- revset 校验（拒绝 `--` 与全局参数），路径必须落在仓库内；
- 命令有超时与输出上限，失败会在面板里原样展示；`撤销`（`jj undo`）始终在工具栏一步可达。

## 开发

```bash
npm install
npm run build      # tsc(host) + tsc(client) + 打包 lib/client.js
npm test           # 构建 + 单元/集成测试（有 jj 时跑真实仓库）
```

集成测试默认仓库为 `D:\agent-research`，可用 `JJ_TEST_REPO` 覆盖。

## 许可证

MIT
