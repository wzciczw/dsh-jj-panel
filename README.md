# dsh-jj-panel

English | [简体中文](README.zh.md)

A [Jujutsu](https://jj-vcs.dev) history panel for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web GUI. It reads `jj` directly — no git translation — and shows the change graph, change details, changed files and diffs in its own **Jujutsu** tab, and shapes history through the same jj-native workflow.

![status](https://img.shields.io/badge/dsh->=0.2.1--rc.2-blue) ![status](https://img.shields.io/badge/jj->=0.44-5c4ee5)

## Features

- **Change tree** — `jj log` rendered as lanes: change IDs, commit IDs, bookmarks, tags, `empty` / `conflict` / `divergent` markers, the `@` working-copy commit, and the `main` (or `master`) trunk lane highlighted.
- **Change details** — full description, author and timestamp, changed files with their status (`M`/`A`/`D`/`R`).
- **Diffs** — click a changed file to load its `jj diff --git` output with `+`/`-` colouring.
- **Revset box** — the panel loads `all()` by default (switch to `::@` to focus the current stack); type any revset (`all()`, `bookmarks()`, `description("…")`) and press Enter.
- **Structural editing** — right-click (or the `⋯` button) for new change here, edit, describe, squash into parent, abandon (or the whole subtree), duplicate, revert before `@`, split by file, copy change id, and push a bookmark.
- **Drag to rebase** — drag one row onto another to rebase it; hold Alt to insert the change before the target (reorder a stack). Drops onto the change itself or its descendants are ignored.
- **Split by file** — toggle split mode in the change details, tick files, then "Split into new change": the ticked files move into a new child of the current `@` change, and the original keeps its description.
- **Undo / Fetch** — toolbar actions; destructive operations (abandon, subtree abandon, revert, undo, push) open an inline confirmation naming the action and target change before any write.
- **Keyboard** — `j`/`k` move the selection, `Enter` edits, `n` creates a new change on the selection, `u` asks to undo, `/` focuses the revset box.

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

- Host half: a Cordis plugin registering a `TypertRemoteService` named `jjPanel` with five Remote methods — `snapshot`, `log`, `show`, `diff` and `op`. Every command is spawned as an argv array, never through a shell.
- Browser half: a React panel registered on `conversation.view`, talking to the host through `connection.rpc.call(rpc, "/api", "jjPanel", …)`.
- Data comes from a `jj log --no-graph -T …` template (change id, commit id, parents, bookmarks, tags, flags, description first line); details use `jj show --no-patch -T 'json(self)'`.
- Every structural edit goes through `jjPanel/op` with an action plus params; the host builds the argv and returns stdout, which the panel shows in its status line.

## Safety

- Writes are limited to the allowlisted `op` actions; the browser half never constructs jj commands.
- Abandon, subtree abandon, revert, undo and push require `confirm: true`; the panel asks first and the host rejects unconfirmed calls.
- Revsets are validated (no `--` / global flags); paths must stay inside the repository.
- Output is capped and commands time out; failures surface verbatim in the panel, and `Undo` (`jj undo`) is always one toolbar click away.

## Development

```bash
npm install
npm run build      # tsc (host) + tsc (client) + bundle lib/client.js
npm test           # build + unit/integration tests (real jj when available)
```

The integration tests use `JJ_TEST_REPO` when set, otherwise `D:\agent-research`.

## License

MIT
