# Changelog

## 0.2.1

- When the browser half hot-reloads before the host half, `jjPanel/op` returns
  HTTP 404. The panel now shows a "restart DSH" hint instead of a raw transport
  error, so the mismatch is actionable.

## 0.2.0

VisualJJ-style structural editing.

- **Change tree** with the `main`/`master` trunk lane highlighted, `@`, bookmark,
  tag, empty, conflict and divergent markers.
- **Structural operations** through a validated host RPC: new change here, edit,
  describe, squash into parent, abandon (and subtree), duplicate, revert,
  rebase (child of a target, or insert before/after), split by file, undo,
  fetch, bookmark and push.
- **Split** creates a new child of the current `@` change with the ticked files
  and keeps the original description; only the working-copy change can split.
- **Revert** inserts before `@` so the generated change stays visible.
- **Drag to rebase**: plain drop = child of the target, Alt-drop = insert before
  the target (reorder); cycles are rejected client-side.
- **Confirmations** for abandon, subtree abandon, revert, undo and push; the host
  also rejects those calls without `confirm: true`.
- **Safer argv**: `--message=…`, `--` before filesets, leading-dash paths
  rejected, message NULs rejected, change ids restricted to `@`/`[a-z0-9]+`.
- **Keyboard** scoped to panel focus (`j`/`k`, `Enter`, `n`, `u`, `/`), plus
  request tokens so stale refreshes/diffs cannot overwrite newer state.
- Docs: `docs/architecture.md` describes the feature model, host contract and
  the independent-implementation boundary (VisualJJ is proprietary; no code or
  assets are copied).

## 0.1.0

Read-only panel: change graph, change details, changed files, diffs, revset box
and refresh, backed by `jjPanel/log|show|diff`.
