# dsh-jj-panel architecture (VisualJJ-style panel)

> Status: design for the 0.2 line. The 0.1 release is read-only; this document
> describes the change-tree panel with structural editing.

## 1. Goals

Make the DSH web GUI a usable jj client for daily version management:

- see the repository as a **change tree** with `main` as the trunk;
- **shape** work: new change at any point, edit any change, squash, abandon,
  duplicate, revert, rebase/reorder (drag), split by file, describe, undo;
- **navigate** quickly: click for details, double-click to edit, revset filter,
  keyboard movement, bookmarks/tags/`@` markers, conflicts and empty changes;
- **share** minimally: fetch, rebase on main, bookmark, push (PR/CI integration
  is optional and depends on a logged-in `gh`).

Non-goals: bundling a jj binary (VisualJJ ships one; we use the system `jj`),
GitHub OAuth, line-level interactive split (jj's `--interactive` needs a TTY;
we ship file-level split first), and any UI copying from VisualJJ.

## 2. What VCS visualizers do (implementation survey)

Git Graph (VS Code) draws a DAG by walking commits newest-first and keeping one
lane per "expected next commit": each commit occupies the lane waiting for it,
its first parent inherits that lane, extra parents take new lanes. Refs are
rendered as chips, the list is virtualized, and context menus shell out to git
(`checkout`, `merge`, `rebase`, `cherry-pick`, `reset`, `tag`, `push`). GitLens
adds webview-based file/blame views and search. VisualJJ applies the same lane
model to jj changes, but the tree is oriented as *main trunk on the left* and
interactions are structural: drag a change onto another to rebase it, Alt-drag
to reorder inside a stack, drag files between changes to move them, double-click
to enter a change, and a popup Squash button.

Our panel keeps the lane algorithm (already in `src/client/graph.ts`) and adds:

| VisualJJ behavior | DSH implementation |
|---|---|
| main on the left, changes branch right | lane layout with the trunk lane pinned for the base bookmark |
| click = details, double-click = edit | select + `jj edit` |
| New Change Here | `jj new <rev> -m …` |
| drag change onto change = rebase | `jj rebase -r <src> --onto <dst>` |
| Alt-drag = reorder | `jj rebase -r <src> --onto <parent-of-dst>` |
| Squash popup | `jj squash --from <child> --into <parent>` |
| Abandon / subtree abandon | `jj abandon <rev>` / `jj abandon '<rev>::'` |
| Revert | `jj revert -r <rev> --onto <dest>` |
| Duplicate | `jj duplicate <rev> --onto <dest>` |
| Split by file | `jj split -r <rev> <paths>` |
| Undo | `jj undo` |
| Fetch / Rebase on main | `jj git fetch`, `jj rebase -r <rev> --onto <main>` |
| Create/Update PR, CI status | out of scope; optional `gh` follow-up |

## 3. Host design

New Remote methods on the existing `jjPanel` service:

```
snapshot(sessionId)                 -> { root, version, current, mainBookmark, opId }
log(sessionId, revset, limit)       -> commits[]              (existing)
show(sessionId, change)             -> commit + files         (existing)
diff(sessionId, change, path)       -> patch                  (existing)
op(sessionId, action, params, confirm) -> { stdout, change? }
```

`op` is the only write path. The host:

1. validates `action` against a fixed allowlist and validates every revset/change
   id/path with the existing guards;
2. requires `confirm: true` for destructive actions (`abandon`, `undo`, `push`,
   `revert`);
3. spawns an argv array (no shell), 8 s deadline, 4 MB cap;
4. returns stderr on failure and never swallows it.

Actions and argv (verified against jj 0.46 help):

| action | argv |
|---|---|
| `new` | `jj new <onto> [-m msg]` |
| `edit` | `jj edit <change>` |
| `describe` | `jj describe -r <change> -m <msg>` |
| `squash` | `jj squash --from <child> --into <parent>` (or `-r <change>`) |
| `abandon` | `jj abandon <change>` / subtree: `<change>::` |
| `duplicate` | `jj duplicate <change> [--onto <dest>]` |
| `revert` | `jj revert -r <change> --onto <dest>` |
| `rebase` | `jj rebase -r <change> --onto <dest>` |
| `split` | `jj split -r <change> <paths...>` |
| `undo` | `jj undo` |
| `fetch` | `jj git fetch` |
| `bookmark` | `jj bookmark set <name> -r <change>` |
| `push` | `jj git push --bookmark <name>` |

Revset/path/message validation lives in `src/host/validate.ts`; messages are
passed as the value of `-m`, never interpolated into a shell string.

## 4. Client design

The panel becomes a three-column layout:

```
┌ toolbar: revset | refresh | undo | fetch ──────────────────────┐
├ change tree (main trunk + lanes) ┬ details + files + diff ────┤
│ @  observatory   work in progress │ change id / commit id       │
│ ●  add panel                      │ description (editable)     │
│ ●  bootstrap                      │ changed files → diff       │
└───────────────────────────────────┴────────────────────────────┘
```

- **Tree rendering**: reuse `layoutGraph`; draw the trunk lane (the main
  bookmark's lane) with a stronger line; every node is a row with lane indent,
  change id chip, description, bookmark/tag chips, `@` and `empty/conflict`
  markers.
- **Interactions**:
  - single click selects; double click runs `edit`;
  - right click opens a context menu (New here, Edit, Describe, Squash,
    Abandon, Abandon subtree, Duplicate, Revert, Split by file, Copy change id);
  - drag a row onto another row and drop = `rebase`; hold Alt to reorder
    (rebase onto the target's parent);
  - destructive items open a confirm dialog showing the exact jj command and
    require a second click;
  - toolbar: refresh, undo (confirm), fetch, revset input.
- **After every write**: reload the log, keep selection by change id, show a
  transient status line with the command result; failures stay visible.
- **Keyboard**: `j`/`k` move, `Enter` edit, `n` new on selection, `u` undo,
  `/` focus revset.
- **Empty/error states**: not a jj repo, jj missing, cwd unavailable; each names
  the next action.

## 5. Safety and recovery

- All writes go through `op`; the client never constructs jj commands.
- Destructive actions require explicit confirmation and display the argv.
- Every write is followed by a snapshot reload; the toolbar exposes **Undo**
  (`jj undo`) and the error bar shows stderr verbatim.
- No background writes, no auto-push; `push` requires confirmation and a
  bookmark name.
- `--config`, `--repository`, `--ignore-immutable` and similar global flags are
  rejected by the revset guard.

## 6. Testing

- Host: unit tests for guards and argv construction; integration tests on a
  temporary colocated repo covering every action (new/edit/describe/squash/
  abandon/duplicate/revert/rebase/split/undo/bookmark).
- Client: SSR tests for the tree rendering and menu wiring; RPC-envelope test
  for the `op` call shape.
- Manual: this repository (`@`, bookmarks, 185 commits), plus a scratch repo.

## 7. Milestones

| Milestone | Scope |
|---|---|
| M1 (shipped 0.1) | read-only graph, details, diffs |
| M2 | `op` RPC + tree UI + new/edit/describe/undo |
| M3 | squash/abandon/duplicate/revert/rebase (menu + drag) |
| M4 | split by file, bookmark, fetch/push, confirmations, keyboard |

## 8. Licensing note

VisualJJ is proprietary and closed-source. This plugin is an independent
implementation driven by public documentation and observed behavior; it contains
no VisualJJ code, assets, or text, and is not affiliated with VisualJJ.
