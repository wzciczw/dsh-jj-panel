# dsh-jj-panel

[English](README.md) | 简体中文

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI 用的 [Jujutsu](https://jj-vcs.dev) 历史面板。直接读 `jj`（不经过 git 转译），在独立的 **Jujutsu** 标签页里展示 change 图、change 详情、改动文件与差异。

## 功能

- **change 图**：`jj log` 渲染为分道图，含 change ID、commit ID、bookmark、tag、`empty`/`conflict`/`divergent` 标记，`@` 工作副本提交置顶；
- **change 详情**：完整描述、作者与时间、改动文件及状态（`M`/`A`/`D`/`R`）；
- **差异**：点击文件加载 `jj diff --git`，按 `+`/`-` 着色；
- **revset 输入框**：默认 `::@`，可输入 `all()`、`bookmarks()`、`description("…")`；
- **只读**：不调用任何 jj 写操作，不调用 git，不发起网络请求。插件只会执行 `jj log`、`jj show`、`jj diff`、`jj root`、`jj --version`。

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

- host 半：Cordis 插件，注册 `TypertRemoteService`（命名空间 `jjPanel`），暴露 `snapshot` / `log` / `show` / `diff` 四个 Remote 方法；所有命令以 argv 数组 spawn，不经过 shell。
- browser 半：React 面板注册到 `conversation.view`，通过 `connection.rpc.call(rpc, "/api", "jjPanel", …)` 调 host。
- 数据来自 `jj log --no-graph -T …` 模板（change id、commit id、parents、bookmarks、tags、标记、描述首行）；详情用 `jj show --no-patch -T 'json(self)'`。

## 安全边界

- 只读：不会执行 `jj new`、`jj describe`、`jj undo`、bookmark 写操作或 `jj git push`；
- revset 校验（拒绝 `--` 与全局参数），路径必须落在仓库内；
- 命令有超时与输出上限，失败会显示在面板里而不是静默吞掉。

## 开发

```bash
npm install
npm run build      # tsc(host) + tsc(client) + 打包 lib/client.js
npm test           # 构建 + 单元/集成测试（有 jj 时跑真实仓库）
```

集成测试默认仓库为 `D:\agent-research`，可用 `JJ_TEST_REPO` 覆盖。

## 许可证

MIT
