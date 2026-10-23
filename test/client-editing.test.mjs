import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const React = require("react");
const ops = require("../lib/client-build/ops.cjs");

function commit(overrides) {
  return {
    changeId: "aaaaaaaa",
    commitId: "00000000",
    parents: [],
    bookmarks: [],
    tags: [],
    empty: false,
    conflict: false,
    divergent: false,
    subject: "",
    ...overrides
  };
}

function loadBundle() {
  const code = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  let loaded;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(entry) {
          loaded = entry;
        }
      }
    },
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "lib/client.js" });
  assert.ok(loaded !== undefined, "bundle did not register with the module loader");
  return loaded.factory((id) => {
    if (id === "react") return React;
    throw new Error(`unexpected require: ${id}`);
  });
}

test("client ops: payload matches the jjPanel/op request contract", () => {
  assert.deepEqual(
    ops.opPayload("s", {
      action: "abandon",
      confirm: true,
      params: { change: "abc", subtree: true }
    }),
    {
      sessionId: "s",
      action: "abandon",
      confirm: true,
      params: { change: "abc", subtree: true }
    }
  );
  assert.deepEqual(ops.opPayload("s", { action: "fetch" }), { sessionId: "s", action: "fetch" });
  assert.deepEqual(
    ops.opPayload("s", { action: "rebase", params: { change: "a", destination: "b" } }),
    { sessionId: "s", action: "rebase", params: { change: "a", destination: "b" } }
  );
  assert.deepEqual(
    ops.opPayload("s", { action: "split", params: { change: "abc", paths: ["a.txt", "b/c.txt"] } }),
    { sessionId: "s", action: "split", params: { change: "abc", paths: ["a.txt", "b/c.txt"] } }
  );
  assert.deepEqual(
    ops.opPayload("s", { action: "revert", confirm: true, params: { change: "abc", destination: "@" } }),
    { sessionId: "s", action: "revert", confirm: true, params: { change: "abc", destination: "@" } }
  );
  assert.deepEqual(
    ops.opPayload("s", { action: "push", confirm: true, params: { name: "feature" } }),
    { sessionId: "s", action: "push", confirm: true, params: { name: "feature" } }
  );
  assert.equal(Object.hasOwn(ops.opPayload("s", { action: "new" }), "confirm"), false);
  assert.equal(Object.hasOwn(ops.opPayload("s", { action: "new" }), "params"), false);
});

test("client ops: only destructive host actions require confirmation", () => {
  for (const action of ["abandon", "revert", "undo", "push"]) {
    assert.equal(ops.opNeedsConfirm(action), true, action);
  }
  for (const action of ["new", "edit", "describe", "squash", "duplicate", "rebase", "split", "fetch"]) {
    assert.equal(ops.opNeedsConfirm(action), false, action);
  }
});

test("client: op RPC calls use the jjPanel/op endpoint and args.req envelope", async () => {
  const mod = loadBundle();
  const calls = [];
  const ctx = {
    get: (key) =>
      key === "connection"
        ? {
            rpc: {
              call: (...args) => {
                calls.push(args);
                return Promise.resolve({ ok: true, value: { ok: true, value: { action: "undo", stdout: "" } } });
              }
            }
          }
        : undefined
  };
  const rpc = mod.createRpc(ctx);
  assert.equal(typeof rpc, "function");
  const payload = ops.opPayload("s", { action: "undo", confirm: true });
  const response = await rpc("op", payload);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/api");
  assert.equal(calls[0][1], "jjPanel/op");
  assert.equal(
    JSON.stringify(calls[0][2]),
    JSON.stringify({ args: { req: { sessionId: "s", action: "undo", confirm: true } } })
  );
  assert.equal(response.ok, true);
});

test("client ops: descendants are computed from commit parents", () => {
  const history = [
    commit({ changeId: "c", commitId: "ccc", parents: ["bbb"] }),
    commit({ changeId: "b", commitId: "bbb", parents: ["aaa"] }),
    commit({ changeId: "a", commitId: "aaa", parents: [] }),
    commit({ changeId: "x", commitId: "xxx", parents: ["aaa"] })
  ];
  assert.equal(ops.isDescendant(history, "ccc", "aaa"), true);
  assert.equal(ops.isDescendant(history, "ccc", "bbb"), true);
  assert.equal(ops.isDescendant(history, "aaa", "ccc"), false);
  assert.equal(ops.isDescendant(history, "xxx", "ccc"), false);
  assert.equal(ops.isDescendant(history, "zzz", "aaa"), false);
});

test("client ops: drop plans reject self and descendants, alt inserts before the target", () => {
  const history = [
    commit({ changeId: "c", commitId: "ccc", parents: ["bbb"] }),
    commit({ changeId: "b", commitId: "bbb", parents: ["aaa"] }),
    commit({ changeId: "a", commitId: "aaa", parents: [] }),
    commit({ changeId: "x", commitId: "xxx", parents: ["aaa"] })
  ];
  assert.deepEqual(ops.planRebaseDrop(history, "c", "a"), {
    ok: true,
    destination: "a",
    mode: "onto"
  });
  // Reorder x (sibling of b) before b: insert-before keeps it in the stack.
  assert.deepEqual(ops.planRebaseDrop(history, "x", "b", { alt: true }), {
    ok: true,
    destination: "b",
    mode: "before"
  });
  // Alt onto a descendant is still a cycle and must be rejected.
  assert.deepEqual(ops.planRebaseDrop(history, "c", "a", { alt: true }), {
    ok: false,
    reason: "descendant"
  });
  assert.deepEqual(ops.planRebaseDrop(history, "c", "c"), { ok: false, reason: "self" });
  assert.deepEqual(ops.planRebaseDrop(history, "a", "c"), {
    ok: false,
    reason: "descendant"
  });
  assert.deepEqual(ops.planRebaseDrop(history, "missing", "a"), {
    ok: false,
    reason: "missing"
  });
});

test("client ops: menu enablement follows change state", () => {
  const root = commit({ changeId: "root", commitId: "r", parents: [], bookmarks: ["main"] });
  const feature = commit({
    changeId: "feat",
    commitId: "f",
    parents: ["r"],
    bookmarks: ["feature"],
    empty: true
  });
  const ids = ops.menuItems({ commit: feature, currentChangeId: "feat" }).map((item) => item.id);
  assert.deepEqual(ids, [
    "new",
    "edit",
    "describe",
    "squash",
    "abandon",
    "abandon-subtree",
    "duplicate",
    "revert",
    "split",
    "copy",
    "push"
  ]);

  const byId = (list) => Object.fromEntries(list.map((item) => [item.id, item]));
  const featureMenu = byId(ops.menuItems({ commit: feature, currentChangeId: "feat" }));
  assert.equal(featureMenu.squash.enabled, true);
  assert.equal(featureMenu.revert.enabled, false, "revert cannot target @ itself");
  assert.equal(featureMenu.split.enabled, false, "an empty change has nothing to split");
  assert.equal(featureMenu.push.visible, true);
  assert.equal(featureMenu.push.destructive, true);
  assert.equal(featureMenu.abandon.destructive, true);

  const rootMenu = byId(ops.menuItems({ commit: root, currentChangeId: "feat" }));
  assert.equal(rootMenu.squash.enabled, false, "a root change has no parent to squash into");
  assert.equal(rootMenu.revert.enabled, true);
  assert.equal(rootMenu.push.visible, true);
  assert.equal(rootMenu.split.enabled, false, "only the current @ change can split");

  const current = commit({ changeId: "cur", commitId: "c", parents: ["r"], bookmarks: [] });
  const currentMenu = byId(ops.menuItems({ commit: current, currentChangeId: "cur" }));
  assert.equal(currentMenu.split.enabled, true, "the current non-empty change can split");

  const pushless = byId(
    ops.menuItems({ commit: commit({ changeId: "plain" }), currentChangeId: null })
  );
  assert.equal(pushless.push.visible, false);
  assert.equal(pushless.revert.enabled, true, "revert is allowed when @ is unknown");

  const busy = byId(ops.menuItems({ commit: feature, currentChangeId: "feat", busy: true }));
  assert.equal(
    Object.values(busy).filter((item) => item.visible).every((item) => item.enabled === false),
    true
  );
});

test("client ops: trunk bookmarks prefer main over master", () => {
  const history = [
    commit({ changeId: "c", bookmarks: ["main@origin"] }),
    commit({ changeId: "b", bookmarks: ["master"] }),
    commit({ changeId: "a", bookmarks: ["main"] })
  ];
  assert.equal(ops.trunkChangeId(history), "a");
  assert.equal(ops.trunkChangeId(history.slice(0, 2)), "b");
  assert.equal(ops.trunkChangeId(history.slice(0, 1)), "c");
  assert.equal(ops.trunkChangeId([commit({ changeId: "z", bookmarks: ["feature"] })]), null);
  assert.equal(ops.isTrunkBookmark("main"), true);
  assert.equal(ops.isTrunkBookmark("master@origin"), true);
  assert.equal(ops.isTrunkBookmark("feature"), false);
});

test("client ops: keyboard selection stays inside the list", () => {
  const history = ["a", "b", "c"].map((id) => commit({ changeId: id, commitId: id }));
  assert.equal(ops.nextSelection(history, "b", 1), "c");
  assert.equal(ops.nextSelection(history, "b", -1), "a");
  assert.equal(ops.nextSelection(history, "a", -1), "a");
  assert.equal(ops.nextSelection(history, "c", 1), "c");
  assert.equal(ops.nextSelection(history, null, 1), "a");
  assert.equal(ops.nextSelection(history, null, -1), "c");
  assert.equal(ops.nextSelection(history, "stale", 1), "a");
  assert.equal(ops.nextSelection([], "a", 1), null);
});

test("client ops: errors and op results are rendered verbatim", () => {
  assert.equal(ops.formatError({ code: "jj-error", message: "  boom\n" }), "jj-error: boom");
  assert.equal(ops.formatError({ code: "jj-missing" }), "jj-missing");
  assert.equal(ops.formatError({ code: "jj-error", message: "   " }), "jj-error");
  assert.equal(ops.formatOpResult({ action: "fetch", stdout: "\n" }), "fetch ok");
  assert.equal(ops.formatOpResult({ action: "edit", stdout: "Now at abc\n" }), "Now at abc");
  assert.equal(ops.errorHintKey("not-a-repo"), "hintNotRepo");
  assert.equal(ops.errorHintKey("jj-missing"), "hintJjMissing");
  assert.equal(ops.errorHintKey("cwd-unavailable"), "hintCwd");
  assert.equal(ops.errorHintKey("something-else"), null);
});
