# dsh-jj-panel

English | [简体中文](README.zh.md)

A [Jujutsu](https://jj-vcs.dev) history panel for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web GUI. It reads `jj` directly — no git translation — and shows the change graph, change details, changed files and diffs in its own **Jujutsu** tab.

![status](https://img.shields.io/badge/dsh->=0.2.1--rc.2-blue) ![status](https://img.shields.io/badge/jj->=0.44-5c4ee5)

## Features

- **Change graph** — `jj log` rendered as lanes: change IDs, commit IDs, bookmarks, tags, `empty` / `conflict` / `divergent` markers, the `@` working-copy commit on top.
- **Change details** — full description, author and timestamp, changed files with their status (`M`/`A`/`D`/`R`).
- **Diffs** — click a changed file to load its `jj diff --git` output with `+`/`-` colouring.
- **Revset box** — the panel loads `::@` by default; type any revset (`all()`, `bookmarks()`, `description("…")`) and press Enter.
- **Read-only** — no jj write operations, no git calls, no network. The plugin only runs `jj log`, `jj show`, `jj diff`, `jj root` and `jj --version`.

## Requirements

- DSH `0.2.1-rc.2` or newer within the `0.2.x` line (web profile).
- `jj` 0.44+ on `PATH`, or configure `jjPath`.
- The workspace must be a Jujutsu repository (`jj git init --colocate` in an existing git repo works).

## Install

```bash
dsh plugin --profile web add dsh-jj-panel
```

Or from a checkout:

```bash
dsh plugin --profile web add file:D:\path\to\dsh-jj-panel
```

After installing, open the **Jujutsu** tab next to the other conversation views. Host-side changes need a DSH restart; the browser half hot-reloads.

### Plugin market source

This repository ships a format-1 market index at [`market/index.json`](market/index.json). Add this URL as a market source under **Plugins → Discover** to install the pinned version:

```
https://raw.githubusercontent.com/wzciczw/dsh-jj-panel/master/market/index.json
```

The index is validated against `@deepseek-ai/dsh-plugin-market-index` in the test suite.

## Configuration

The plugin accepts an optional config block (profile `cordis.patch.yml` or the plugin settings page):

```yaml
- id: jj-panel
  name: "dsh-jj-panel"
  config:
    jjPath: 'C:\path\to\jj.exe'   # default: PATH, then the winget install location
    timeoutMs: 8000               # per jj command
    maxBytes: 4194304             # stdout cap
    defaultLimit: 120             # commits per load (1..500)
```

## How it works

- Host half: a Cordis plugin registering a `TypertRemoteService` named `jjPanel` with four Remote methods — `snapshot`, `log`, `show`, `diff`. Every command is spawned as an argv array, never through a shell.
- Browser half: a React panel registered on `conversation.view`, talking to the host through `connection.rpc.call(rpc, "/api", "jjPanel", …)`.
- Data comes from a `jj log --no-graph -T …` template (change id, commit id, parents, bookmarks, tags, flags, description first line); details use `jj show --no-patch -T 'json(self)'`.

## Safety

- Read-only: the plugin never runs `jj new`, `jj describe`, `jj undo`, `jj bookmark` writes or `jj git push`.
- Revsets are validated (no `--` / global flags); paths must stay inside the repository.
- Output is capped and commands time out; failures surface in the panel instead of being swallowed.

## Development

```bash
npm install
npm run build      # tsc (host) + tsc (client) + bundle lib/client.js
npm test           # build + unit/integration tests (real jj when available)
```

The integration tests use `JJ_TEST_REPO` when set, otherwise `D:\agent-research`.

## License

MIT
